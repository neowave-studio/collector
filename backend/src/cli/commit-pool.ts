/**
 * Commits a generated pool on-chain and mirrors it into the database.
 *
 *   npm run pool:commit -- --file pools/elite-4m.json --chain bnb_testnet --version 2
 *
 * Six steps, in an order the contracts enforce:
 *   1. mint the inventory NFTs and deposit them into the vault
 *   2. commitPoolStart / commitPoolChunk x N / finalizePool  (the partition is verified ON-CHAIN)
 *   3. verify the stored root equals the one in the file
 *   4. allowlist the pay token and set the buyback outflow cap  [Timelock]
 *   5. fund the reserve so `rip` can book its worst case
 *   6. schedule activation, and write the leaves to the database
 *
 * Chunked because `MAX_LEAVES_PER_CHUNK` is 400: a 4,000-card pool is ten `commitPoolChunk` calls,
 * and the contract refuses to store a root until every leaf has been verified to tile the weight
 * space exactly. That is the whole point of the chunked API — a half-committed pool has no root and
 * therefore cannot be drawn against.
 *
 * Written in TypeScript rather than as a Forge script because Forge cannot read a 4,000-entry JSON
 * array without heroics, and because this needs to talk to the database in the same run.
 */
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPublicClient, createWalletClient, http, keccak256, parseAbi, toBytes, type Address, type Hex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {gachaAbi} from '../lib/abi.js';
import {pool, transaction} from '../db/index.js';

const here = dirname(fileURLToPath(import.meta.url));
/** `MAX_LEAVES_PER_CHUNK` in PoolLib. The contract's own bound on partition verification per call. */
const CHUNK = 400;

/**
 * Mints per transaction. Much smaller than CHUNK, and for a different reason: each ERC-721 mint costs
 * ~91k gas, so 400 of them is ~36M — under BSC's 100M block limit but above the per-transaction cap
 * the RPC will accept, which surfaces as a bare `execution reverted: 0x` with no reason data.
 */
const MINT_CHUNK = 100;

/**
 * Explicit gas limits, so viem never calls `eth_estimateGas`.
 *
 * Estimation runs against the node's `latest` state, which can still lag the receipt we just awaited.
 * A deposit estimated before its own mint has propagated reverts — the token is not owned yet — and
 * surfaces as a bare `execution reverted` that looks like a contract rejection rather than a timing
 * artefact. These come from test/unit/CommitGas.t.sol with roughly 50% headroom:
 *   mintBatch      75,473/card   depositBatch   56,522/card   commitPoolChunk  25,737/leaf
 */
const GAS = {
  mintBatch: 12_000_000n,
  depositBatch: 10_000_000n,
  // ~10.3M measured for a full 400-leaf chunk. Kept well under Base's per-transaction cap, which
  // rejects anything around 18M outright with "gas limit too high" — so this has to be tight enough
  // to be accepted and loose enough to cover the work.
  commitChunk: 14_000_000n,
  commitStart: 400_000n,
  finalize: 6_000_000n,
  erc20: 200_000n,
  fund: 400_000n,
} as const;

interface PoolFile {
  packId: Hex;
  merkleRoot: Hex;
  pricePerRip: string;
  buybackBps: number;
  unavailableBps: number;
  houseMarginBps: number;
  reserveBps: number;
  totalWeight: string;
  totalValue: string;
  maxReservePerRip: string;
  cardCount: number;
  leaves: {tokenId: string; cumBefore: string; weight: string; priceRef: string; leafHash: Hex}[];
  cards: {tokenId: string; name: string; set: string; grade: string; priceRef: string}[];
}

function arg(flag: string, fallback?: string): string {
  const i = process.argv.indexOf(flag);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (!v && fallback === undefined) throw new Error(`${flag} is required`);
  return v ?? fallback!;
}

async function main(): Promise<void> {
  const file = arg('--file');
  const chainKey = arg('--chain');
  const version = BigInt(arg('--version', '2'));
  const reserveFunding = BigInt(arg('--reserve', '0'));

  const poolFile = JSON.parse(readFileSync(join(here, '../../..', file), 'utf8')) as PoolFile;
  const registry = JSON.parse(
    readFileSync(join(here, '../../../contracts/script/chains.json'), 'utf8'),
  ) as {chains: {key: string; chainId: number; testnet?: boolean; payTokens: Record<string, Address>}[]};
  const entry = registry.chains.find((c) => c.key === chainKey);
  if (!entry) throw new Error(`chains.json has no entry for "${chainKey}"`);
  if (!entry.testnet) throw new Error(`"${chainKey}" is not a testnet; this script is for rehearsals only`);

  const deployment = JSON.parse(
    readFileSync(join(here, `../../../contracts/deployments/${chainKey}.json`), 'utf8'),
  ) as Record<string, Address>;

  const rpcUrl = process.env.RPC_URL;
  if (!rpcUrl) throw new Error('RPC_URL is required');
  const payToken = Object.values(entry.payTokens)[0]!;

  const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex);
  const chain = {
    id: entry.chainId,
    name: chainKey,
    nativeCurrency: {name: 'ETH', symbol: 'ETH', decimals: 18},
    rpcUrls: {default: {http: [rpcUrl]}},
  } as const;
  const client = createPublicClient({chain, transport: http(rpcUrl)});
  const wallet = createWalletClient({account, chain, transport: http(rpcUrl)});

  const erc20 = parseAbi([
    'function approve(address,uint256) returns (bool)',
    'function mint(address,uint256)',
    'function balanceOf(address) view returns (uint256)',
  ]);
  const nft = parseAbi([
    'function mintBatch(address,uint256[],bytes32[])',
    'function setApprovalForAll(address,bool)',
  ]);
  const vault = parseAbi(['function depositBatch(uint256[],bytes32)']);
  const reserve = parseAbi(['function fund(address,uint256)']);

  /**
   * Nonces are tracked locally, not re-fetched per transaction.
   *
   * viem asks the node for the nonce at `latest` before every send. Over 25+ sequential transactions
   * that loses a race: `waitForTransactionReceipt` returns as soon as the receipt exists, but
   * `eth_getTransactionCount` can still report the pre-transaction count for a moment, so the next
   * send reuses a nonce and the node rejects it as "replacement transaction underpriced" — an error
   * that reads like a gas problem and is actually a counting problem.
   */
  // `pending`, not `latest`: latest excludes transactions already sitting in the mempool, so a prior
  // run's in-flight send leaves the first nonce here one too low.
  let nonce = await client.getTransactionCount({address: account.address, blockTag: 'pending'});
  const nextNonce = () => nonce++;

  const send = async (hash: Hex, label: string) => {
    const r = await client.waitForTransactionReceipt({hash});
    if (r.status !== 'success') throw new Error(`${label} reverted (${hash})`);
  };

  /**
   * Retries submission errors that are about the node's state, not ours.
   *
   * Three distinct ones show up when driving tens of sequential transactions through a public RPC,
   * and none of them means the call is wrong:
   *
   *  - "in-flight transaction limit reached for delegated accounts" — this deployer is an EIP-7702
   *    delegated account (its code starts 0xef0100), and Base caps how many of its transactions may
   *    be in flight at once. Far stricter than for a plain EOA.
   *  - "replacement transaction underpriced" / "nonce too low" — the node's transaction count lagging
   *    behind a receipt we already awaited.
   *
   * All three clear on their own, so back off and re-read the nonce rather than aborting a run that is
   * two thirds finished.
   */
  const submit = async (label: string, build: () => Promise<Hex>): Promise<void> => {
    for (let attempt = 1; ; attempt++) {
      try {
        await send(await build(), label);
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const transient =
          msg.includes('in-flight transaction limit') ||
          msg.includes('replacement transaction underpriced') ||
          msg.includes('nonce too low') ||
          msg.includes('already known');
        if (!transient || attempt >= 8) throw err;
        const waitMs = 2000 * attempt;
        console.log(`   ${label}: ${msg.split(/\r?\n/)[0]} - retrying in ${waitMs / 1000}s`);
        await new Promise((r) => setTimeout(r, waitMs));
        // Re-sync from the chain; a locally-tracked nonce is exactly what drifts after a rejection.
        nonce = await client.getTransactionCount({address: account.address, blockTag: 'pending'});
      }
    }
  };

  console.log(`\nCommitting ${poolFile.cardCount} cards to ${chainKey} as version ${version}`);
  console.log(`  pay token   ${payToken}`);
  console.log(`  root        ${poolFile.merkleRoot}`);
  // Already finalized? Skip straight to verification. A finalized pool is immutable — re-running
  // commitPoolStart would revert PoolAlreadyCommitted — so without this, a run that failed AFTER the
  // commit (a bad root in the file, a funding error) could never be resumed.
  const existing = await client.readContract({
    address: deployment.gachaMachine!,
    abi: gachaAbi,
    functionName: 'getPoolVersion',
    args: [poolFile.packId, version],
  });
  const alreadyCommitted = existing.finalized;
  if (alreadyCommitted) {
    console.log(`  version ${version} is already finalized on-chain - verifying and seeding only`);
  }

  // --- 1. inventory -----------------------------------------------------------------------------
  // Minted and deposited in the same chunk size as the pool commit, so a failure leaves a clean
  // prefix rather than inventory that exists but is not in the vault.
  // Inventory and the commit itself are skipped when the version is already finalized.
  if (!alreadyCommitted) {
  console.log('\n1. inventory');

  // Idempotent: the vault's approval persists, so a resumed run should not spend a transaction — or a
  // nonce — re-setting it. Missing this is what made the first Base Sepolia attempt fail: the approval
  // went out without an explicit nonce while every later send used the local counter, and the two
  // disagreed by one.
  const approved = await client.readContract({
    address: deployment.collectibleNFT!,
    abi: parseAbi(['function isApprovedForAll(address,address) view returns (bool)']),
    functionName: 'isApprovedForAll',
    args: [account.address, deployment.vault!],
  });
  if (!approved) {
    await submit('setApprovalForAll', () => wallet.writeContract({
        address: deployment.collectibleNFT!,
        abi: nft,
        functionName: 'setApprovalForAll',
        args: [deployment.vault!, true],
        nonce: nextNonce(),
        gas: GAS.erc20,
      }));
  } else {
    console.log('   vault approval already set');
  }

  /**
   * Resumable, because this is 80+ transactions and something will interrupt it.
   *
   * Minting and depositing are SEPARATE transactions, so a run can stop between them and a batch has
   * three possible states, not two. Treating "minted" as "done" strands the cards that were minted but
   * never deposited: they are owned by the deployer, absent from the vault, and `commitPoolChunk` then
   * rejects the whole pool with WrongPack. Ask about the state that actually matters — is the card in
   * the vault — and mint only when it does not yet exist.
   */
  const stateOf = async (tokenId: bigint): Promise<'missing' | 'minted' | 'deposited'> => {
    const held = await client.readContract({
      address: deployment.vault!,
      abi: parseAbi(['function isHeld(uint256) view returns (bool)']),
      functionName: 'isHeld',
      args: [tokenId],
    });
    if (held) return 'deposited';
    try {
      await client.readContract({
        address: deployment.collectibleNFT!,
        abi: parseAbi(['function ownerOf(uint256) view returns (address)']),
        functionName: 'ownerOf',
        args: [tokenId],
      });
      return 'minted';
    } catch {
      // ERC721NonexistentToken. Any other RPC failure would also land here, so a transient error costs
      // one redundant mint attempt that reverts loudly rather than corrupting state silently.
      return 'missing';
    }
  };

  let skipped = 0;
  for (let i = 0; i < poolFile.cards.length; i += MINT_CHUNK) {
    const slice = poolFile.cards.slice(i, i + MINT_CHUNK);
    const ids = slice.map((c) => BigInt(c.tokenId));

    const state = await stateOf(ids[0]!);
    if (state === 'deposited') {
      skipped += slice.length;
      continue;
    }
    if (skipped > 0) {
      console.log(`   skipped ${skipped} already in vault`);
      skipped = 0;
    }
    const needsMint = state === 'missing';
    if (!needsMint) {
      console.log(`   ${ids[0]}..${ids[ids.length - 1]} already minted, depositing only`);
    }
    // Says on-chain what it is. There is no graded card behind a rehearsal pool, and a
    // realistic-looking certificate hash would misrepresent that. keccak256 of a self-describing
    // string, so it is unique per card (mintBatch rejects duplicates) and legible in a trace.
    const commitments = slice.map((c) =>
      keccak256(toBytes(`TESTNET-NOT-A-REAL-CERT-${entry.chainId}-v${version}-${c.tokenId}`)),
    );
    if (needsMint) {
      await submit(`mintBatch ${i}`, () => wallet.writeContract({
          address: deployment.collectibleNFT!,
          abi: nft,
          functionName: 'mintBatch',
          args: [account.address, ids, commitments],
          nonce: nextNonce(),
          gas: GAS.mintBatch,
        }));
    }
    await submit(`depositBatch ${i}`, () => wallet.writeContract({
        address: deployment.vault!,
        abi: vault,
        functionName: 'depositBatch',
        args: [ids, poolFile.packId],
        nonce: nextNonce(),
        gas: GAS.depositBatch,
      }));
    if ((i / MINT_CHUNK) % 5 === 0 || i + MINT_CHUNK >= poolFile.cards.length) {
      console.log(`   ${Math.min(i + MINT_CHUNK, poolFile.cards.length)}/${poolFile.cards.length}`);
    }
  }

  // --- 2. pool commit ---------------------------------------------------------------------------
  console.log('\n2. pool commit');

  /**
   * The commit phase is resumable too, in two places.
   *
   * `commitPoolStart` opens a draft and reverts DraftAlreadyStarted on a second call, so a run that
   * died after the draft but before its chunks could never restart. And `poolLeafCount` reports how
   * many leaves the draft already holds, so chunks resume from there rather than re-submitting ones
   * the contract has already verified.
   *
   * This is not belt-and-braces: a partially committed pool has no root by design, so without both of
   * these an interrupted commit is unrecoverable and the only way forward is a fresh version number.
   */
  const DRAFT_ALREADY_STARTED = '0x6be47984';
  try {
    await submit('commitPoolStart', () => wallet.writeContract({
        address: deployment.gachaMachine!,
        abi: gachaAbi,
        functionName: 'commitPoolStart',
        args: [
          poolFile.packId,
          version,
          {
            pricePerRip: BigInt(poolFile.pricePerRip),
            payToken,
            buybackBps: poolFile.buybackBps,
            unavailableBps: poolFile.unavailableBps,
            houseMarginBps: poolFile.houseMarginBps,
            reserveBps: poolFile.reserveBps,
            poolCID: poolFile.merkleRoot,
          },
        ],
        nonce: nextNonce(),
      }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes(DRAFT_ALREADY_STARTED)) throw err;
    console.log('   draft already open, resuming');
    nonce = await client.getTransactionCount({address: account.address, blockTag: 'pending'});
  }

  const alreadyCommitted2 = await client.readContract({
    address: deployment.gachaMachine!,
    abi: gachaAbi,
    functionName: 'poolLeafCount',
    args: [poolFile.packId, version],
  });
  const startFrom = Number(alreadyCommitted2);
  if (startFrom > 0) console.log(`   ${startFrom} leaves already committed, resuming`);

  for (let i = startFrom; i < poolFile.leaves.length; i += CHUNK) {
    const slice = poolFile.leaves.slice(i, i + CHUNK).map((l) => ({
      tokenId: BigInt(l.tokenId),
      cumBefore: BigInt(l.cumBefore),
      weight: BigInt(l.weight),
      priceRef: BigInt(l.priceRef),
    }));
    await submit(`commitPoolChunk ${i}`, () => wallet.writeContract({
        address: deployment.gachaMachine!,
        abi: gachaAbi,
        functionName: 'commitPoolChunk',
        args: [poolFile.packId, version, slice],
        nonce: nextNonce(),
        gas: GAS.commitChunk,
      }));
    console.log(`   ${Math.min(i + CHUNK, poolFile.leaves.length)}/${poolFile.leaves.length}`);
  }

  await submit('finalizePool', () => wallet.writeContract({
      address: deployment.gachaMachine!,
      abi: gachaAbi,
      functionName: 'finalizePool',
      args: [poolFile.packId, version],
    }));

  }

  // --- 3. verify --------------------------------------------------------------------------------
  const onChain = await client.readContract({
    address: deployment.gachaMachine!,
    abi: gachaAbi,
    functionName: 'getPoolVersion',
    args: [poolFile.packId, version],
  });
  if (onChain.root.toLowerCase() !== poolFile.merkleRoot.toLowerCase()) {
    throw new Error(`root mismatch\n  on-chain ${onChain.root}\n  file     ${poolFile.merkleRoot}`);
  }
  console.log('\n3. root verified against chain');
  console.log(`   maxReservePerRip ${onChain.maxReservePerRip}`);

  // --- 4/5. reserve -----------------------------------------------------------------------------
  if (reserveFunding > 0n) {
    console.log('\n4. reserve');
    await submit('mint pay token', () => wallet.writeContract({
        address: payToken,
        abi: erc20,
        functionName: 'mint',
        args: [account.address, reserveFunding],
        nonce: nextNonce(),
        gas: GAS.erc20,
      }));
    await submit('approve reserve', () => wallet.writeContract({
        address: payToken,
        abi: erc20,
        functionName: 'approve',
        args: [deployment.reserveVault!, reserveFunding],
        nonce: nextNonce(),
        gas: GAS.erc20,
      }));
    await submit('fund reserve', () => wallet.writeContract({
        address: deployment.reserveVault!,
        abi: reserve,
        functionName: 'fund',
        args: [payToken, reserveFunding],
        nonce: nextNonce(),
        gas: GAS.fund,
      }));
    console.log(`   funded ${reserveFunding}`);
  }

  // --- 6. database ------------------------------------------------------------------------------
  console.log('\n5. database');
  await transaction(async (db) => {
    await db.query(
      `INSERT INTO pool_versions (
         chain_id, pack_id, version, merkle_root, total_weight, card_count, price_per_rip, pay_token,
         buyback_bps, unavailable_bps, house_margin_bps, reserve_bps, max_reserve_per_rip, pool_cid,
         ipfs_pins, price_ref_source, price_ref_snapshot_at, committed_tx, committed_block)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now(),'pool:commit',0)
       ON CONFLICT (chain_id, pack_id, version) DO NOTHING`,
      [
        entry.chainId,
        poolFile.packId,
        version.toString(),
        poolFile.merkleRoot,
        poolFile.totalWeight,
        poolFile.cardCount,
        poolFile.pricePerRip,
        payToken,
        poolFile.buybackBps,
        poolFile.unavailableBps,
        poolFile.houseMarginBps,
        poolFile.reserveBps,
        poolFile.maxReservePerRip,
        `${chainKey}-pool-v${version}`,
        [],
        'testnet rehearsal fixture (NOT a real price feed)',
      ],
    );

    for (let i = 0; i < poolFile.leaves.length; i++) {
      const l = poolFile.leaves[i]!;
      const card = poolFile.cards[i]!;
      await db.query(
        `INSERT INTO pool_leaves (chain_id, pack_id, version, leaf_index, token_id, cum_before, weight, price_ref, leaf_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
        [entry.chainId, poolFile.packId, version.toString(), i, l.tokenId, l.cumBefore, l.weight, l.priceRef, l.leafHash],
      );
      await db.query(
        `INSERT INTO nfts (chain_id, token_id, cert_number, grade, grading_co, scan_hash, commitment,
                           name, set_name, year, image_url, location, pack_id)
         VALUES ($1,$2,$3,$4,'PSA','rehearsal',$5,$6,$7,1999,'/chari.png','vault',$8)
         ON CONFLICT (chain_id, token_id) DO NOTHING`,
        [
          entry.chainId,
          l.tokenId,
          `REHEARSAL-${l.tokenId}`,
          card.grade,
          poolFile.leaves[i]!.leafHash,
          card.name,
          card.set,
          poolFile.packId,
        ],
      );
    }
  });
  console.log(`   ${poolFile.leaves.length} leaves and cards written`);

  console.log('\nDone. Activate it with:');
  console.log(`   cast send ${deployment.gachaMachine} "setActivePoolVersion(bytes32,uint256,uint64)" \\`);
  console.log(`     ${poolFile.packId} ${version} <current block + minActivationDelayBlocks + margin>`);
  await pool.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

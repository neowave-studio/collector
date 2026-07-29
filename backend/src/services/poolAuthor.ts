import {createWalletClient, encodeFunctionData, http, type Address, type Hex} from 'viem';
import {getChain, type ChainContext} from '../chains.js';
import {gachaAbi, vaultAbi} from '../lib/abi.js';
import {
  assertValidPartition,
  computeRoot,
  houseMarginHolds,
  leafHashes,
  type PoolLeaf,
} from '../lib/merkle.js';
import {getSigner} from './signer.js';
import {query, transaction} from '../db/index.js';
import {logger} from '../lib/logger.js';
import {publishPoolFile, type PublishResult} from './publish.js';

/**
 * Pool authoring (spec §8.2).
 *
 * The backend's job here is deliberately small, because the contract does the part that matters:
 * `commitPool` re-derives the partition and BUILDS the Merkle root itself, so nothing the backend
 * submits can rig the odds. What the backend must get right is the part the contract cannot check —
 * publishing the full pool file at the CID that gets pinned on-chain, so a user can rebuild the tree
 * independently and, if we disappear, settle without us.
 *
 * Order of operations matters and is enforced below:
 *   1. validate the partition + economics locally (catch it in CI, not as a reverted tx);
 *   2. publish the pool file and obtain its CID;
 *   3. commit on-chain WITH that CID, so the published file is tamper-evident from the moment the
 *      version exists — never the other way round, which would leave a window where committed odds
 *      had no published file.
 */

export interface PoolCard {
  tokenId: bigint;
  weight: bigint;
  /** Fair-market reference, in pay-token units. Immutable for the life of this version. */
  priceRef: bigint;
  name: string;
  setName: string;
  year: number;
  grade: string;
  gradingCo: string;
  certNumber: string;
  imageUrl?: string;
}

export interface PoolDraftInput {
  chainId: number;
  packId: Hex;
  version: bigint;
  name: string;
  pricePerRip: bigint;
  payToken: Address;
  buybackBps: number;
  unavailableBps: number;
  houseMarginBps: number;
  reserveBps: number;
  cards: PoolCard[];
  /** Where the priceRefs came from, and when. Published with the file (spec §5.4 FIX M2-fair). */
  priceRefSource: string;
  priceRefSnapshotAt: Date;
}

/** Cards per `commitPoolChunk` call — matches `PoolLib.MAX_LEAVES_PER_CHUNK`. */
const MAX_LEAVES_PER_CHUNK = 400;

export interface PoolFile {
  schema: 'collector.pool.v1';
  chainId: number;
  gachaMachine: Address;
  packId: Hex;
  version: string;
  merkleRoot: Hex;
  totalWeight: string;
  pricePerRip: string;
  payToken: Address;
  buybackBps: number;
  unavailableBps: number;
  houseMarginBps: number;
  priceRefProvenance: {source: string; snapshotAt: string};
  /** How to rebuild the tree without trusting us. */
  verification: {
    leafEncoding: string;
    domainTag: Hex;
    pairHashing: string;
    oddNodes: string;
    tool: string;
  };
  cards: {
    leafIndex: number;
    tokenId: string;
    cumBefore: string;
    weight: string;
    /** Chance of this exact card, as a decimal string, for disclosure (spec §12). */
    probability: string;
    priceRef: string;
    leafHash: Hex;
    name: string;
    setName: string;
    year: number;
    grade: string;
    gradingCo: string;
    certNumber: string;
    imageUrl?: string;
  }[];
}

function toLeaves(cards: PoolCard[]): PoolLeaf[] {
  // Ascending tokenId is required on-chain (it is what makes duplicates impossible), so sort here
  // rather than making the caller remember.
  const sorted = [...cards].sort((a, b) => (a.tokenId < b.tokenId ? -1 : a.tokenId > b.tokenId ? 1 : 0));
  let cum = 0n;
  return sorted.map((card) => {
    const leaf: PoolLeaf = {tokenId: card.tokenId, cumBefore: cum, weight: card.weight, priceRef: card.priceRef};
    cum += card.weight;
    return leaf;
  });
}

export function buildPoolFile(input: PoolDraftInput, chain: ChainContext): {file: PoolFile; leaves: PoolLeaf[]} {
  const leaves = toLeaves(input.cards);
  const {totalWeight} = assertValidPartition(leaves);

  if (
    !houseMarginHolds({
      leaves,
      pricePerRip: input.pricePerRip,
      buybackBps: BigInt(input.buybackBps),
      houseMarginBps: BigInt(input.houseMarginBps),
    })
  ) {
    throw new Error(
      'House-margin invariant fails: the weighted expected buyback exceeds the rip price net of margin. ' +
        'commitPool would revert. Lower buybackBps, lower the priceRefs, or raise pricePerRip.',
    );
  }
  if (input.unavailableBps < input.buybackBps) {
    throw new Error('unavailableBps must be >= buybackBps, otherwise a compensation could exceed its reservation.');
  }

  const hashes = leafHashes(input.packId, input.version, leaves);
  const merkleRoot = computeRoot(hashes);

  const sortedCards = [...input.cards].sort((a, b) => (a.tokenId < b.tokenId ? -1 : a.tokenId > b.tokenId ? 1 : 0));

  const file: PoolFile = {
    schema: 'collector.pool.v1',
    chainId: input.chainId,
    gachaMachine: chain.deployment.gachaMachine,
    packId: input.packId,
    version: input.version.toString(),
    merkleRoot,
    totalWeight: totalWeight.toString(),
    pricePerRip: input.pricePerRip.toString(),
    payToken: input.payToken,
    buybackBps: input.buybackBps,
    unavailableBps: input.unavailableBps,
    houseMarginBps: input.houseMarginBps,
    priceRefProvenance: {source: input.priceRefSource, snapshotAt: input.priceRefSnapshotAt.toISOString()},
    verification: {
      leafEncoding:
        'keccak256(abi.encode(bytes32 DOMAIN_TAG, bytes32 packId, uint256 version, uint256 leafIndex, ' +
        'uint256 tokenId, uint256 cumBefore, uint256 weight, uint256 priceRef))',
      domainTag: '0x' as Hex,
      pairHashing: 'keccak256(min(a,b) || max(a,b)) — commutative, sorted pairs',
      oddNodes: 'a trailing odd node is promoted unchanged to the next level',
      tool: 'https://github.com/neowave-studio/collector/tree/main/tools/proof-generator',
    },
    cards: leaves.map((leaf, i) => {
      const card = sortedCards[i]!;
      return {
        leafIndex: i,
        tokenId: leaf.tokenId.toString(),
        cumBefore: leaf.cumBefore.toString(),
        weight: leaf.weight.toString(),
        probability: (Number(leaf.weight) / Number(totalWeight)).toFixed(10),
        priceRef: leaf.priceRef.toString(),
        leafHash: hashes[i]!,
        name: card.name,
        setName: card.setName,
        year: card.year,
        grade: card.grade,
        gradingCo: card.gradingCo,
        certNumber: card.certNumber,
        ...(card.imageUrl ? {imageUrl: card.imageUrl} : {}),
      };
    }),
  };

  return {file, leaves};
}

/** Refuses to author a pool containing a card the vault does not hold for this pack. */
async function assertInventoryBacking(chain: ChainContext, packId: Hex, leaves: PoolLeaf[]): Promise<void> {
  const missing: string[] = [];
  for (const leaf of leaves) {
    const [held, assigned] = await Promise.all([
      chain.client.readContract({
        address: chain.deployment.vault,
        abi: vaultAbi,
        functionName: 'isHeld',
        args: [leaf.tokenId],
      }),
      chain.client.readContract({
        address: chain.deployment.vault,
        abi: vaultAbi,
        functionName: 'tokenPack',
        args: [leaf.tokenId],
      }),
    ]);
    if (!held) missing.push(`${leaf.tokenId} (not in vault)`);
    else if (assigned.toLowerCase() !== packId.toLowerCase()) missing.push(`${leaf.tokenId} (earmarked to ${assigned})`);
  }
  if (missing.length) {
    throw new Error(
      `Pool would promise cards this pack does not hold 1:1 — commitPool would revert. Offenders: ${missing.join(', ')}`,
    );
  }
}

export interface CommitResult {
  merkleRoot: Hex;
  publish: PublishResult;
  txHashes: Hex[];
}

export async function commitPool(input: PoolDraftInput): Promise<CommitResult> {
  const chain = getChain(input.chainId);
  if (!chain.gachaEnabled) {
    throw new Error(`Chain ${chain.key} is marketplace-only (no Chainlink VRF v2.5); it cannot host a pool.`);
  }

  const {file, leaves} = buildPoolFile(input, chain);
  await assertInventoryBacking(chain, input.packId, leaves);

  // Publish FIRST so the on-chain commitment can pin the CID of a file that already exists.
  const publish = await publishPoolFile(file);
  logger.info({cid: publish.cid, pins: publish.pins.length}, 'pool file published');

  const signer = getSigner('poolAuthor');
  const wallet = createWalletClient({
    account: signer.account,
    transport: http(chain.rpcUrl),
    chain: {
      id: chain.chainId,
      name: chain.name,
      nativeCurrency: {name: 'ETH', symbol: 'ETH', decimals: 18},
      rpcUrls: {default: {http: [chain.rpcUrl]}},
    },
  });

  const params = {
    pricePerRip: input.pricePerRip,
    payToken: input.payToken,
    buybackBps: input.buybackBps,
    unavailableBps: input.unavailableBps,
    houseMarginBps: input.houseMarginBps,
    reserveBps: input.reserveBps,
    poolCID: publish.cidHash,
  } as const;

  const txHashes: Hex[] = [];
  const send = async (data: Hex) => {
    const hash = await wallet.sendTransaction({
      account: signer.account,
      chain: null,
      to: chain.deployment.gachaMachine,
      data,
    });
    await chain.client.waitForTransactionReceipt({hash, confirmations: chain.confirmations});
    txHashes.push(hash);
    return hash;
  };

  if (leaves.length <= MAX_LEAVES_PER_CHUNK) {
    await send(
      encodeFunctionData({
        abi: gachaAbi,
        functionName: 'commitPool',
        args: [input.packId, input.version, params, leaves],
      }),
    );
  } else {
    await send(
      encodeFunctionData({abi: gachaAbi, functionName: 'commitPoolStart', args: [input.packId, input.version, params]}),
    );
    for (let i = 0; i < leaves.length; i += MAX_LEAVES_PER_CHUNK) {
      const chunk = leaves.slice(i, i + MAX_LEAVES_PER_CHUNK);
      await send(
        encodeFunctionData({abi: gachaAbi, functionName: 'commitPoolChunk', args: [input.packId, input.version, chunk]}),
      );
      logger.info({committed: i + chunk.length, total: leaves.length}, 'pool chunk committed');
    }
    await send(
      encodeFunctionData({abi: gachaAbi, functionName: 'finalizePool', args: [input.packId, input.version]}),
    );
  }

  // Read the root back from the chain rather than trusting what we computed: if these differ, our
  // published file does not describe the committed odds, and the whole fairness claim is void.
  const onChain = await chain.client.readContract({
    address: chain.deployment.gachaMachine,
    abi: gachaAbi,
    functionName: 'getPoolVersion',
    args: [input.packId, input.version],
  });
  if (onChain.root.toLowerCase() !== file.merkleRoot.toLowerCase()) {
    throw new Error(
      `On-chain root ${onChain.root} does not match the published pool file's root ${file.merkleRoot}. ` +
        `Do NOT activate this version.`,
    );
  }

  await persist(input, file, publish, txHashes, chain);
  return {merkleRoot: file.merkleRoot, publish, txHashes};
}

async function persist(
  input: PoolDraftInput,
  file: PoolFile,
  publish: PublishResult,
  txHashes: Hex[],
  chain: ChainContext,
): Promise<void> {
  const block = await chain.client.getBlockNumber();
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO packs (chain_id, pack_id, name) VALUES ($1, $2, $3)
       ON CONFLICT (chain_id, pack_id) DO UPDATE SET name = EXCLUDED.name`,
      [input.chainId, input.packId, input.name],
    );

    await client.query(
      `INSERT INTO pool_versions (
         chain_id, pack_id, version, merkle_root, total_weight, card_count, price_per_rip, pay_token,
         buyback_bps, unavailable_bps, house_margin_bps, reserve_bps, max_reserve_per_rip, pool_cid,
         ipfs_pins, arweave_tx, price_ref_source, price_ref_snapshot_at, committed_tx, committed_block)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [
        input.chainId,
        input.packId,
        input.version.toString(),
        file.merkleRoot,
        file.totalWeight,
        file.cards.length,
        input.pricePerRip.toString(),
        input.payToken,
        input.buybackBps,
        input.unavailableBps,
        input.houseMarginBps,
        input.reserveBps,
        (
          (BigInt(file.cards.reduce((max, c) => (BigInt(c.priceRef) > BigInt(max) ? c.priceRef : max), '0')) *
            BigInt(input.unavailableBps)) /
          10_000n
        ).toString(),
        publish.cid,
        publish.pins,
        publish.arweaveTx ?? null,
        input.priceRefSource,
        input.priceRefSnapshotAt,
        txHashes[txHashes.length - 1] ?? '',
        block.toString(),
      ],
    );

    for (const card of file.cards) {
      await client.query(
        `INSERT INTO pool_leaves (chain_id, pack_id, version, leaf_index, token_id, cum_before, weight, price_ref, leaf_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          input.chainId,
          input.packId,
          input.version.toString(),
          card.leafIndex,
          card.tokenId,
          card.cumBefore,
          card.weight,
          card.priceRef,
          card.leafHash,
        ],
      );
    }
  });
}

/** Announces the activation block. Never same-block — the contract enforces the minimum delay too. */
export async function scheduleActivation(chainId: number, packId: Hex, version: bigint): Promise<Hex> {
  const chain = getChain(chainId);
  const signer = getSigner('poolAuthor');

  const [current, minDelay] = await Promise.all([
    chain.client.getBlockNumber(),
    chain.client.readContract({
      address: chain.deployment.gachaMachine,
      abi: gachaAbi,
      functionName: 'minActivationDelayBlocks',
    }),
  ]);
  // Extra headroom over the contract's minimum so the announcement is genuinely visible before it
  // binds, rather than technically-in-the-future-by-one-block.
  const activeFrom = current + minDelay + 30n;

  const wallet = createWalletClient({
    account: signer.account,
    transport: http(chain.rpcUrl),
    chain: {
      id: chain.chainId,
      name: chain.name,
      nativeCurrency: {name: 'ETH', symbol: 'ETH', decimals: 18},
      rpcUrls: {default: {http: [chain.rpcUrl]}},
    },
  });

  const hash = await wallet.sendTransaction({
    account: signer.account,
    chain: null,
    to: chain.deployment.gachaMachine,
    data: encodeFunctionData({
      abi: gachaAbi,
      functionName: 'setActivePoolVersion',
      args: [packId, version, activeFrom],
    }),
  });

  await query(
    `UPDATE packs SET active_pool_version = $3, active_from_block = $4 WHERE chain_id = $1 AND pack_id = $2`,
    [chainId, packId, version.toString(), activeFrom.toString()],
  );
  logger.info({packId, version: version.toString(), activeFrom: activeFrom.toString()}, 'activation announced');
  return hash;
}

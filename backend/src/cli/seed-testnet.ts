/**
 * Seeds the database for a real (non-anvil) chain.
 *
 *   CHAIN_KEY=base_sepolia INDEXER_START_BLOCK=44777209 npm run seed:testnet
 *
 * `SetupTestnet.s.sol` commits the pool on-chain, but only the leaf *hashes* live there. The contents
 * — which card, what weight, what reference price — are deliberately off-chain, and the backend needs
 * them to build settlement proofs and to publish odds. This writes those rows.
 *
 * As with the devnet seeder, the leaves are re-derived here and the computed root is checked against
 * the root the contract actually stored. That check is the point: it is the same verification a user
 * performs against a published pool file, so if this script and the chain ever disagree, the cached
 * odds do not describe the committed ones and nothing downstream should trust them.
 *
 * The one thing this does that the devnet seeder does not need to: set `last_indexed_block`. A real
 * chain is millions of blocks old, and the indexer walks forward from wherever the cursor sits. Left
 * at the default of zero it would try to scan the entire chain in 2,000-block batches and never
 * reach the present.
 */
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPublicClient, http, keccak256, toBytes, type Address, type Hex} from 'viem';
import {computeRoot, leafHashes, type PoolLeaf} from '../lib/merkle.js';
import {gachaAbi} from '../lib/abi.js';
import {pool, transaction} from '../db/index.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Must mirror `SetupTestnet.s.sol` — same pack id, same weights, same reference prices. */
const PACK_ID = keccak256(toBytes('collector.pack.elite.v1'));
const WEIGHTS = [300n, 250n, 200n, 120n, 80n, 30n, 15n, 5n];
const PRICE_REFS = [300_000n, 400_000n, 500_000n, 600_000n, 800_000n, 1_200_000n, 2_000_000n, 3_000_000n];

const CARDS = [
  {name: 'Bulbasaur Holo', set: 'Base Set', year: 1999, grade: 'PSA 7'},
  {name: 'Squirtle Holo', set: 'Base Set', year: 1999, grade: 'PSA 7'},
  {name: 'Eevee Holo', set: 'Jungle', year: 1999, grade: 'PSA 8'},
  {name: 'Snorlax Holo', set: 'Jungle', year: 1999, grade: 'PSA 8'},
  {name: 'Gengar Holo', set: 'Fossil', year: 1999, grade: 'PSA 9'},
  {name: 'Mewtwo Holo', set: 'Base Set', year: 1999, grade: 'PSA 9'},
  {name: 'Blastoise Holo', set: 'Base Set', year: 1999, grade: 'PSA 9'},
  {name: 'Charizard Holo', set: 'Base Set', year: 1999, grade: 'PSA 10'},
];

interface RegistryEntry {
  key: string;
  chainId: number;
  name: string;
  gachaEnabled: boolean;
  confirmations: number;
  vrf: {coordinator: string} | null;
  payTokens: Record<string, string>;
}

async function main(): Promise<void> {
  const chainKey = process.env.CHAIN_KEY;
  if (!chainKey) throw new Error('CHAIN_KEY is required (a key from contracts/script/chains.json)');
  if (chainKey === 'anvil') throw new Error('use `npm run devnet:seed` for the devnet');

  const registry = JSON.parse(
    readFileSync(join(here, '../../../contracts/script/chains.json'), 'utf8'),
  ) as {chains: RegistryEntry[]};
  const entry = registry.chains.find((c) => c.key === chainKey);
  if (!entry) throw new Error(`chains.json has no entry for "${chainKey}"`);

  const deployment = JSON.parse(
    readFileSync(join(here, `../../../contracts/deployments/${chainKey}.json`), 'utf8'),
  ) as {gachaMachine: Address; chainId: number};

  const rpcUrl = process.env.RPC_URL ?? process.env[`${chainKey.toUpperCase()}_RPC_URL`];
  if (!rpcUrl) throw new Error(`set RPC_URL or ${chainKey.toUpperCase()}_RPC_URL`);

  const payToken = Object.values(entry.payTokens)[0];
  if (!payToken) throw new Error(`chains.json has no payTokens for "${chainKey}"`);

  // Without this the indexer starts at block 1. On a chain tens of millions of blocks deep that is
  // not slow, it is unreachable — so require it rather than defaulting to something plausible.
  const startBlock = process.env.INDEXER_START_BLOCK;
  if (!startBlock) {
    throw new Error(
      'INDEXER_START_BLOCK is required: the block just BEFORE the deployment. Take the lowest ' +
        'blockNumber in contracts/broadcast/Deploy.s.sol/<chainId>/run-latest.json and subtract one.',
    );
  }

  const version = 1n;
  const leaves: PoolLeaf[] = [];
  let cum = 0n;
  for (let i = 0; i < WEIGHTS.length; i++) {
    leaves.push({tokenId: BigInt(i + 1), cumBefore: cum, weight: WEIGHTS[i]!, priceRef: PRICE_REFS[i]!});
    cum += WEIGHTS[i]!;
  }

  const hashes = leafHashes(PACK_ID, version, leaves);
  const computed = computeRoot(hashes);

  const client = createPublicClient({transport: http(rpcUrl)});
  const onChain = await client.readContract({
    address: deployment.gachaMachine,
    abi: gachaAbi,
    functionName: 'getPoolVersion',
    args: [PACK_ID, version],
  });

  if (onChain.root.toLowerCase() !== computed.toLowerCase()) {
    throw new Error(
      `Root mismatch.\n  on-chain: ${onChain.root}\n  computed: ${computed}\n` +
        'The leaves in this script no longer match SetupTestnet.s.sol.',
    );
  }
  console.log(`root verified against chain: ${computed}`);

  await transaction(async (db) => {
    await db.query(
      `INSERT INTO chains (chain_id, chain_key, name, gacha_enabled, vrf_coordinator, confirmations, last_indexed_block)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (chain_id) DO UPDATE
         SET vrf_coordinator = EXCLUDED.vrf_coordinator,
             confirmations = EXCLUDED.confirmations,
             -- Never move the cursor BACKWARDS on a re-run: that would re-scan blocks already
             -- indexed and re-apply their events.
             last_indexed_block = GREATEST(chains.last_indexed_block, EXCLUDED.last_indexed_block)`,
      [
        entry.chainId,
        entry.key,
        entry.name,
        entry.gachaEnabled,
        entry.vrf?.coordinator ?? null,
        entry.confirmations,
        startBlock,
      ],
    );

    await db.query(
      `INSERT INTO packs (chain_id, pack_id, name, image_url, active_pool_version, active_from_block)
       VALUES ($1,$2,'Elite Pokemon Gacha Pack','/productimage.png',$3,$4)
       ON CONFLICT (chain_id, pack_id) DO UPDATE SET active_pool_version = EXCLUDED.active_pool_version`,
      [entry.chainId, PACK_ID, version.toString(), startBlock],
    );

    await db.query(
      `INSERT INTO pool_versions (
         chain_id, pack_id, version, merkle_root, total_weight, card_count, price_per_rip, pay_token,
         buyback_bps, unavailable_bps, house_margin_bps, reserve_bps, max_reserve_per_rip, pool_cid,
         ipfs_pins, price_ref_source, price_ref_snapshot_at, committed_tx, committed_block)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now(),'testnet-setup',$17)
       ON CONFLICT (chain_id, pack_id, version) DO NOTHING`,
      [
        entry.chainId,
        PACK_ID,
        version.toString(),
        computed,
        onChain.totalWeight.toString(),
        onChain.cardCount,
        onChain.pricePerRip.toString(),
        payToken,
        onChain.buybackBps,
        onChain.unavailableBps,
        onChain.houseMarginBps,
        onChain.reserveBps,
        onChain.maxReservePerRip.toString(),
        `${chainKey}-rehearsal-pool-v1`,
        [],
        // Named for what it is. These are not observed market prices and must not be shown as though
        // they were.
        'testnet rehearsal fixture (NOT a real price feed)',
        startBlock,
      ],
    );

    for (let i = 0; i < leaves.length; i++) {
      const leaf = leaves[i]!;
      const card = CARDS[i]!;
      await db.query(
        `INSERT INTO pool_leaves (chain_id, pack_id, version, leaf_index, token_id, cum_before, weight, price_ref, leaf_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
        [
          entry.chainId,
          PACK_ID,
          version.toString(),
          i,
          leaf.tokenId.toString(),
          leaf.cumBefore.toString(),
          leaf.weight.toString(),
          leaf.priceRef.toString(),
          hashes[i] as Hex,
        ],
      );
      await db.query(
        `INSERT INTO nfts (chain_id, token_id, cert_number, grade, grading_co, scan_hash, commitment,
                           name, set_name, year, image_url, location, pack_id)
         VALUES ($1,$2,$3,$4,'PSA','rehearsal',$5,$6,$7,$8,'/chari.png','vault',$9)
         ON CONFLICT (chain_id, token_id) DO NOTHING`,
        [
          entry.chainId,
          leaf.tokenId.toString(),
          `REHEARSAL-${leaf.tokenId}`,
          card.grade,
          // Mirrors the commitment SetupTestnet.s.sol minted, which says on-chain that it is not a
          // real certificate.
          keccak256(toBytes(`TESTNET-REHEARSAL-NOT-A-REAL-CERT-${entry.chainId}-${leaf.tokenId}`)),
          card.name,
          card.set,
          card.year,
          PACK_ID,
        ],
      );
    }
  });

  console.log(`seeded ${chainKey} (chain ${entry.chainId}) pack ${PACK_ID} v${version}`);
  console.log(`   price ${Number(onChain.pricePerRip) / 1e6} USDC · buyback ${onChain.buybackBps / 100}%`);
  console.log(`   indexer will start from block ${startBlock}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

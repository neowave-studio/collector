/**
 * Devnet database seed.
 *
 *   npm run devnet:seed
 *
 * `DeployLocal.s.sol` commits the pool ON-CHAIN, but only the leaf *hashes* live there — the contents
 * (which card, what weight, what reference price) are deliberately off-chain, published in the pool
 * file. In production that file is written by the pool author service before it commits. On the devnet
 * the commit happened inside a Forge script, so this fills in the matching database rows.
 *
 * It re-derives the leaves independently and refuses to write unless the root it computes matches the
 * root the contract built — which is exactly the check a user performs against a published pool file.
 * If they ever disagree, the cached odds do not describe the committed ones and nothing should trust
 * them.
 */
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPublicClient, http, keccak256, toBytes, type Address, type Hex} from 'viem';
import {computeRoot, leafHashes, type PoolLeaf} from '../lib/merkle.js';
import {gachaAbi} from '../lib/abi.js';
import {pool, transaction} from '../db/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const RPC = process.env.ANVIL_RPC_URL ?? 'http://127.0.0.1:8545';
const CHAIN_ID = 31337;

/** Must mirror `DeployLocal.s.sol::_leaves()` exactly. */
const WEIGHTS = [300n, 250n, 200n, 120n, 80n, 30n, 15n, 5n];
const PRICE_REFS = [20_000_000n, 24_000_000n, 28_000_000n, 35_000_000n, 48_000_000n, 90_000_000n, 180_000_000n, 600_000_000n];

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

async function main(): Promise<void> {
  const deployment = JSON.parse(
    readFileSync(join(here, '../../../contracts/deployments/anvil.json'), 'utf8'),
  ) as {gachaMachine: Address; usdc: Address; vrfCoordinator: Address; chainId: number};

  const packId = keccak256(toBytes('PKMN50'));
  const version = 1n;

  const leaves: PoolLeaf[] = [];
  let cum = 0n;
  for (let i = 0; i < WEIGHTS.length; i++) {
    leaves.push({tokenId: BigInt(i + 1), cumBefore: cum, weight: WEIGHTS[i]!, priceRef: PRICE_REFS[i]!});
    cum += WEIGHTS[i]!;
  }

  const hashes = leafHashes(packId, version, leaves);
  const computed = computeRoot(hashes);

  const client = createPublicClient({transport: http(RPC)});
  const onChain = await client.readContract({
    address: deployment.gachaMachine,
    abi: gachaAbi,
    functionName: 'getPoolVersion',
    args: [packId, version],
  });

  if (onChain.root.toLowerCase() !== computed.toLowerCase()) {
    throw new Error(
      `Root mismatch.\n  on-chain: ${onChain.root}\n  computed: ${computed}\n` +
        `The leaves in this script no longer match DeployLocal.s.sol::_leaves().`,
    );
  }
  console.log(`root verified against chain: ${computed}`);

  await transaction(async (client_) => {
    await client_.query(
      `INSERT INTO chains (chain_id, chain_key, name, gacha_enabled, vrf_coordinator, confirmations)
       VALUES ($1,'anvil','Anvil Devnet',TRUE,$2,1)
       ON CONFLICT (chain_id) DO UPDATE SET vrf_coordinator = EXCLUDED.vrf_coordinator`,
      [CHAIN_ID, deployment.vrfCoordinator],
    );

    await client_.query(
      `INSERT INTO packs (chain_id, pack_id, name, image_url, active_pool_version, active_from_block)
       VALUES ($1,$2,'Elite Pokemon Gacha Pack','/productimage.png',$3,0)
       ON CONFLICT (chain_id, pack_id) DO UPDATE
         SET active_pool_version = EXCLUDED.active_pool_version`,
      [CHAIN_ID, packId, version.toString()],
    );

    await client_.query(
      `INSERT INTO pool_versions (
         chain_id, pack_id, version, merkle_root, total_weight, card_count, price_per_rip, pay_token,
         buyback_bps, unavailable_bps, house_margin_bps, reserve_bps, max_reserve_per_rip, pool_cid,
         ipfs_pins, price_ref_source, price_ref_snapshot_at, committed_tx, committed_block)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now(),'devnet',0)
       ON CONFLICT (chain_id, pack_id, version) DO NOTHING`,
      [
        CHAIN_ID,
        packId,
        version.toString(),
        computed,
        onChain.totalWeight.toString(),
        onChain.cardCount,
        onChain.pricePerRip.toString(),
        deployment.usdc,
        onChain.buybackBps,
        onChain.unavailableBps,
        onChain.houseMarginBps,
        onChain.reserveBps,
        onChain.maxReservePerRip.toString(),
        'devnet-local-pool-v1',
        [],
        'devnet fixture (not a real price feed)',
      ],
    );

    for (let i = 0; i < leaves.length; i++) {
      const leaf = leaves[i]!;
      const card = CARDS[i]!;
      await client_.query(
        `INSERT INTO pool_leaves (chain_id, pack_id, version, leaf_index, token_id, cum_before, weight, price_ref, leaf_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
        [
          CHAIN_ID,
          packId,
          version.toString(),
          i,
          leaf.tokenId.toString(),
          leaf.cumBefore.toString(),
          leaf.weight.toString(),
          leaf.priceRef.toString(),
          hashes[i] as Hex,
        ],
      );
      await client_.query(
        `INSERT INTO nfts (chain_id, token_id, cert_number, grade, grading_co, scan_hash, commitment,
                           name, set_name, year, image_url, location, pack_id)
         VALUES ($1,$2,$3,$4,'PSA','devnet',$5,$6,$7,$8,'/chari.png','vault',$9)
         ON CONFLICT (chain_id, token_id) DO NOTHING`,
        [
          CHAIN_ID,
          leaf.tokenId.toString(),
          `DEVNET-${leaf.tokenId}`,
          card.grade,
          keccak256(toBytes(`PSA-DEVNET-${leaf.tokenId}`)),
          card.name,
          card.set,
          card.year,
          packId,
        ],
      );
    }
  });

  console.log(`seeded pack ${packId} v${version} with ${leaves.length} cards`);
  console.log(`   price ${Number(onChain.pricePerRip) / 1e6} USDC · buyback ${onChain.buybackBps / 100}%`);
  await pool.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

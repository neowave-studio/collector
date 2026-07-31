/**
 * Makes a fresh database serviceable without a human running CLI steps.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT A SQL MIGRATION
 *
 * A pool commit puts a Merkle *root* on chain. The leaves it commits to — which token, what weight,
 * what reference price, which card — are deliberately kept off chain, because putting 989 of them on
 * chain would cost a fortune in gas. So the database is not a cache of chain state; it holds the
 * preimage of an on-chain commitment. Without it the backend can neither publish odds nor build the
 * proof that settles a draw, and a newly provisioned database has none of it. That is the whole of
 * why a pool already committed on chain still has to be "seeded" again.
 *
 * A `.sql` migration cannot do this job, for one reason that matters more than the rest: it cannot
 * make an RPC call, so it could not check that what it writes matches the root the chain actually
 * stored. It would write 989 rows of odds on the authority of a file. Odds are the one number this
 * product exists to make verifiable, and seeding them unverified would quietly reduce a checkable
 * claim to a trusted one. Every write below happens only after the root has been recomputed from the
 * leaves and compared against the chain — the same check a reader performs against a published pool
 * file. The rest is ordinary unsuitability: pool commits are operational events rather than schema
 * changes, they differ per chain, and a 367 KB fixture inlined as INSERT statements would be frozen
 * at authoring time.
 *
 * Idempotent by construction, and cheap once seeded: a chain whose leaf count already matches is
 * skipped before any RPC call. Safe to run on every boot, which is the point — Render's free tier
 * offers no shell and no pre-deploy hook, so boot is the only place a deployment can repair itself.
 */
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Address, Hex} from 'viem';
import {computeRoot, leafHashes, type PoolLeaf} from '../lib/merkle.js';
import {gachaAbi} from '../lib/abi.js';
import {logger} from '../lib/logger.js';
import {initChains, type ChainContext} from '../chains.js';
import {query, queryOne, transaction} from './index.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../..');

interface PoolFile {
  packId: Hex;
  merkleRoot: Hex;
  pricePerRip: string;
  buybackBps: number;
  unavailableBps: number;
  houseMarginBps: number;
  reserveBps: number;
  totalWeight: string;
  maxReservePerRip: string;
  cardCount: number;
  leaves: {tokenId: string; cumBefore: string; weight: string; priceRef: string; leafHash: Hex}[];
  cards: {tokenId: string; name: string; set: string; grade: string; priceRef: string}[];
}

interface Manifest {
  pools: Record<string, {file: string; version: string}>;
}

function readManifest(): Manifest['pools'] {
  try {
    const raw = readFileSync(join(repoRoot, 'pools/manifest.json'), 'utf8');
    return (JSON.parse(raw) as Manifest).pools ?? {};
  } catch {
    // A deployment that ships no pool fixtures is a legitimate configuration, not a failure.
    logger.debug('no pools/manifest.json — skipping pool bootstrap');
    return {};
  }
}

/**
 * Moves the indexer cursor up to the deployment block.
 *
 * GREATEST, never a plain assignment: on an already-running deployment the cursor is far ahead of
 * the deploy block, and resetting it backwards would re-index and re-settle history.
 */
async function setIndexCursor(chain: ChainContext): Promise<void> {
  const deployBlock = chain.deployment.deployBlock;
  if (!deployBlock) return;

  const before = await queryOne<{last_indexed_block: string}>(
    'SELECT last_indexed_block FROM chains WHERE chain_id = $1',
    [chain.chainId],
  );
  if (BigInt(before?.last_indexed_block ?? '0') >= BigInt(deployBlock)) return;

  await query(
    `UPDATE chains SET last_indexed_block = GREATEST(last_indexed_block, $2), updated_at = now()
     WHERE chain_id = $1`,
    [chain.chainId, deployBlock],
  );
  logger.info({chain: chain.key, deployBlock}, 'indexer cursor advanced to deployment block');
}

/** Seeds one chain's committed pool, but only once its root has been proven against the chain. */
async function seedPool(chain: ChainContext, spec: {file: string; version: string}): Promise<void> {
  const poolFile = JSON.parse(readFileSync(join(repoRoot, spec.file), 'utf8')) as PoolFile;
  const version = BigInt(spec.version);

  // Cheap exit for the overwhelmingly common case: already seeded. Before any RPC call, so a warm
  // deployment pays nothing for this running on every boot.
  const seeded = await queryOne<{count: string}>(
    'SELECT COUNT(*)::text AS count FROM pool_leaves WHERE chain_id = $1 AND pack_id = $2 AND version = $3',
    [chain.chainId, poolFile.packId, spec.version],
  );
  if (Number(seeded?.count ?? '0') >= poolFile.cardCount) return;

  // 1. Is the file internally consistent? Its stated root must follow from its own leaves.
  const leaves: PoolLeaf[] = poolFile.leaves.map((l) => ({
    tokenId: BigInt(l.tokenId),
    cumBefore: BigInt(l.cumBefore),
    weight: BigInt(l.weight),
    priceRef: BigInt(l.priceRef),
  }));
  const computed = computeRoot(leafHashes(poolFile.packId, version, leaves));
  if (computed.toLowerCase() !== poolFile.merkleRoot.toLowerCase()) {
    logger.error(
      {chain: chain.key, file: spec.file, computed, stated: poolFile.merkleRoot},
      'pool file is self-inconsistent — NOT seeding',
    );
    return;
  }

  // 2. Does the chain agree? This is the check a .sql migration could never perform, and the reason
  //    the odds this seeds can be called committed rather than merely configured.
  const onChain = await chain.client.readContract({
    address: chain.deployment.gachaMachine,
    abi: gachaAbi,
    functionName: 'getPoolVersion',
    args: [poolFile.packId, version],
  });

  if (!onChain.finalized) {
    logger.warn(
      {chain: chain.key, version: spec.version},
      'pool version is not finalized on-chain — NOT seeding',
    );
    return;
  }
  if (onChain.root.toLowerCase() !== poolFile.merkleRoot.toLowerCase()) {
    logger.error(
      {chain: chain.key, onChain: onChain.root, file: poolFile.merkleRoot},
      'pool file does not match the committed root — NOT seeding',
    );
    return;
  }

  // The pay token the pool was actually committed with, read from the chain rather than guessed
  // from the registry — a pool committed against a different token would price every draw wrongly.
  const payToken = onChain.payToken as Address;

  await transaction(async (db) => {
    await db.query(
      `INSERT INTO packs (chain_id, pack_id, name, image_url, active_pool_version, active_from_block)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (chain_id, pack_id) DO UPDATE
         SET active_pool_version = GREATEST(packs.active_pool_version, EXCLUDED.active_pool_version)`,
      [
        chain.chainId,
        poolFile.packId,
        'Elite Pokemon Gacha Pack',
        '/productimage.png',
        spec.version,
        chain.deployment.deployBlock ?? 0,
      ],
    );

    await db.query(
      `INSERT INTO pool_versions (
         chain_id, pack_id, version, merkle_root, total_weight, card_count, price_per_rip, pay_token,
         buyback_bps, unavailable_bps, house_margin_bps, reserve_bps, max_reserve_per_rip, pool_cid,
         ipfs_pins, price_ref_source, price_ref_snapshot_at, committed_tx, committed_block)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now(),'bootstrap',$17)
       ON CONFLICT (chain_id, pack_id, version) DO NOTHING`,
      [
        chain.chainId,
        poolFile.packId,
        spec.version,
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
        `${chain.key}-pool-v${spec.version}`,
        [],
        'testnet rehearsal fixture (NOT a real price feed)',
        chain.deployment.deployBlock ?? 0,
      ],
    );

    for (let i = 0; i < poolFile.leaves.length; i++) {
      const l = poolFile.leaves[i]!;
      const card = poolFile.cards[i]!;
      await db.query(
        `INSERT INTO pool_leaves (chain_id, pack_id, version, leaf_index, token_id, cum_before, weight, price_ref, leaf_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
        [chain.chainId, poolFile.packId, spec.version, i, l.tokenId, l.cumBefore, l.weight, l.priceRef, l.leafHash],
      );
      await db.query(
        `INSERT INTO nfts (chain_id, token_id, cert_number, grade, grading_co, scan_hash, commitment,
                           name, set_name, year, image_url, location, pack_id)
         VALUES ($1,$2,$3,$4,'PSA','rehearsal',$5,$6,$7,1999,'/chari.png','vault',$8)
         ON CONFLICT (chain_id, token_id) DO NOTHING`,
        [chain.chainId, l.tokenId, `REHEARSAL-${l.tokenId}`, card.grade, l.leafHash, card.name, card.set, poolFile.packId],
      );
    }
  });

  logger.info(
    {chain: chain.key, version: spec.version, cards: poolFile.cardCount, root: poolFile.merkleRoot},
    'pool seeded and verified against chain',
  );
}

/**
 * Brings every served chain up to a serviceable state.
 *
 * One chain failing does not stop the others, and never stops the process: a backend that refuses to
 * boot because one chain's RPC is briefly unreachable is worse than one serving the chains it can
 * reach. An unseeded chain surfaces as a pack that is simply absent, which the UI already handles.
 */
export async function bootstrap(): Promise<void> {
  const manifest = readManifest();

  for (const chain of initChains()) {
    try {
      await setIndexCursor(chain);

      const spec = manifest[chain.key];
      if (spec) await seedPool(chain, spec);
    } catch (err) {
      logger.error({err, chain: chain.key}, 'bootstrap failed for chain — continuing');
    }
  }
}

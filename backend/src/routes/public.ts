import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import type {Hex} from 'viem';
import {allChains, gachaChains, getChain, isChainServed} from '../chains.js';
import {gachaAbi, reserveVaultAbi} from '../lib/abi.js';
import {query, queryOne} from '../db/index.js';
import {readSession} from '../services/auth.js';
import {selfServeInstructions} from '../services/proofs.js';
import {config} from '../config.js';

/** Read-only endpoints: pack odds, draw status, self-serve recovery, and proof of reserves. */
export async function publicRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ok: true}));

  app.get('/chains', async () =>
    allChains().map((c) => ({
      chainId: c.chainId,
      key: c.key,
      name: c.name,
      testnet: c.testnet ?? false,
      gachaEnabled: c.gachaEnabled,
      // Surfaced rather than hidden: a user on a marketplace-only chain deserves to know why they
      // cannot open packs there, and "no verifiable randomness" is the honest answer (spec §3).
      marketplaceOnlyReason: c.marketplaceOnlyReason ?? null,
      payTokens: c.payTokens,
      explorer: c.explorer,
      contracts: {
        gachaMachine: c.deployment.gachaMachine,
        marketplace: c.deployment.marketplace,
        collectibleNFT: c.deployment.collectibleNFT,
        reserveVault: c.deployment.reserveVault,
        paymentRouter: c.deployment.paymentRouter,
      },
    })),
  );

  /**
   * Full odds disclosure (spec §12 [MUST]). Several jurisdictions legally require loot-box odds to be
   * published; ours are additionally committed on-chain, so this endpoint returns the exact version,
   * root and CID that will bind at rip time — not a marketing summary of them.
   */
  app.get('/packs', async (req, reply) => {
    const packs = await query<{
      chain_id: string;
      pack_id: string;
      name: string;
      image_url: string | null;
      active_pool_version: string | null;
    }>('SELECT chain_id, pack_id, name, image_url, active_pool_version FROM packs ORDER BY name');

    const out = [];
    for (const pack of packs) {
      const chainId = Number(pack.chain_id);
      if (!pack.active_pool_version) continue;
      // The database spans every chain ever seeded here; this process may serve only some of them.
      if (!isChainServed(chainId)) continue;

      const version = await queryOne<{
        merkle_root: string;
        total_weight: string;
        card_count: number;
        price_per_rip: string;
        pay_token: string;
        buyback_bps: number;
        unavailable_bps: number;
        pool_cid: string;
        ipfs_pins: string[];
        arweave_tx: string | null;
        price_ref_source: string;
        price_ref_snapshot_at: Date;
      }>(
        `SELECT merkle_root, total_weight, card_count, price_per_rip, pay_token, buyback_bps,
                unavailable_bps, pool_cid, ipfs_pins, arweave_tx, price_ref_source, price_ref_snapshot_at
           FROM pool_versions WHERE chain_id = $1 AND pack_id = $2 AND version = $3`,
        [chainId, pack.pack_id, pack.active_pool_version],
      );
      if (!version) continue;

      const tiers = await query<{price_ref: string; weight_sum: string; card_count: string}>(
        `SELECT price_ref, SUM(weight)::text AS weight_sum, COUNT(*)::text AS card_count
           FROM pool_leaves WHERE chain_id = $1 AND pack_id = $2 AND version = $3
          GROUP BY price_ref ORDER BY price_ref ASC`,
        [chainId, pack.pack_id, pack.active_pool_version],
      );

      // Read from the contract rather than mirrored in the database: the UI states this window to
      // the user as the deadline on their sell-back decision, so it has to be the figure the chain
      // will actually enforce, not a copy that could drift after a parameter change. Null on a
      // marketplace-only chain, which has no gacha machine to ask.
      const chain = getChain(chainId);
      const buybackWindow = chain.gachaEnabled
        ? await chain.client.readContract({
            address: chain.deployment.gachaMachine,
            abi: gachaAbi,
            functionName: 'buybackWindow',
          })
        : null;

      out.push({
        chainId,
        packId: pack.pack_id,
        name: pack.name,
        imageUrl: pack.image_url,
        buybackWindowSeconds: buybackWindow === null ? null : Number(buybackWindow),
        poolVersion: pack.active_pool_version,
        merkleRoot: version.merkle_root,
        poolCid: version.pool_cid,
        pins: {ipfs: version.ipfs_pins, arweave: version.arweave_tx},
        totalWeight: version.total_weight,
        cardCount: version.card_count,
        pricePerRip: version.price_per_rip,
        payToken: version.pay_token,
        buybackBps: version.buyback_bps,
        unavailableBps: version.unavailable_bps,
        priceRefProvenance: {
          source: version.price_ref_source,
          snapshotAt: version.price_ref_snapshot_at,
        },
        odds: tiers.map((t) => ({
          priceRef: t.price_ref,
          cards: Number(t.card_count),
          weight: t.weight_sum,
          probability: Number(t.weight_sum) / Number(version.total_weight),
        })),
        verifyWith: config.PROOF_TOOL_URL || null,
      });
    }
    return reply.send(out);
  });

  const drawParams = z.object({chainId: z.coerce.number().int().positive(), drawId: z.string()});

  app.get('/draws/:chainId/:drawId', async (req, reply) => {
    const {chainId, drawId} = drawParams.parse(req.params);
    const chain = getChain(chainId);

    const draw = await chain.client.readContract({
      address: chain.deployment.gachaMachine,
      abi: gachaAbi,
      functionName: 'getDraw',
      args: [BigInt(drawId)],
    });
    if (draw.user === '0x0000000000000000000000000000000000000000') {
      return reply.code(404).send({error: 'unknown_draw'});
    }

    const settlement = await queryOne<{kind: string; token_id: string | null; payout: string | null; tx_hash: string}>(
      'SELECT kind, token_id, payout, tx_hash FROM settlements WHERE chain_id = $1 AND draw_id = $2',
      [chainId, drawId],
    );

    return reply.send({
      chainId,
      drawId,
      user: draw.user,
      packId: draw.packId,
      poolVersion: draw.poolVersion.toString(),
      revealed: draw.revealed,
      settled: draw.settled,
      winningWeight: draw.revealed ? draw.winningWeight.toString() : null,
      revealedAt: draw.revealedAt === 0 ? null : Number(draw.revealedAt),
      settlement: settlement ?? null,
    });
  });

  /**
   * Everything a user needs to settle or refund WITHOUT us (spec §8.2).
   * Deliberately unauthenticated: an escape hatch that requires our login is not an escape hatch.
   */
  app.get('/draws/:chainId/:drawId/self-settle', async (req, reply) => {
    const {chainId, drawId} = drawParams.parse(req.params);
    try {
      return reply.send(await selfServeInstructions({chainId, drawId: BigInt(drawId)}));
    } catch (err) {
      return reply.code(404).send({error: err instanceof Error ? err.message : 'unavailable'});
    }
  });

  app.get('/me/draws', async (req, reply) => {
    const session = await readSession(req);
    if (!session) return reply.code(401).send({error: 'authentication_required'});

    const rows = await query(
      `SELECT d.chain_id, d.draw_id, d.pack_id, d.pool_version, d.status, d.winning_weight,
              d.created_at, s.kind, s.token_id, s.payout, s.tx_hash
         FROM draws d LEFT JOIN settlements s ON s.chain_id = d.chain_id AND s.draw_id = d.draw_id
        WHERE d.user_address = $1 ORDER BY d.created_at DESC LIMIT 100`,
      [session.address],
    );
    return reply.send(rows);
  });

  /**
   * Public proof of reserves (spec §5.5, §8.7). `reserved` reflects every outstanding obligation,
   * including ones the user has not exercised — showing only exercised ones would be false comfort.
   */
  app.get('/reserves', async (_req, reply) => {
    const out = [];
    for (const chain of gachaChains()) {
      for (const [symbol, token] of Object.entries(chain.payTokens)) {
        const [balance, reserved, surplus] = await chain.client.readContract({
          address: chain.deployment.reserveVault,
          abi: reserveVaultAbi,
          functionName: 'proofOfReserves',
          args: [token],
        });
        const paused = await chain.client.readContract({
          address: chain.deployment.reserveVault,
          abi: reserveVaultAbi,
          functionName: 'paused',
        });
        out.push({
          chainId: chain.chainId,
          chain: chain.name,
          token,
          symbol,
          balance: balance.toString(),
          reservedLiabilities: reserved.toString(),
          surplus: surplus.toString(),
          solvent: balance >= reserved,
          buybackPaused: paused,
          reserveVault: chain.deployment.reserveVault,
          explorer: chain.explorer ? `${chain.explorer}/address/${chain.deployment.reserveVault}` : null,
        });
      }
    }
    return reply.send(out);
  });

  /** The published pool file's location, so anyone can rebuild the tree themselves. */
  app.get('/packs/:chainId/:packId/:version/pool-file', async (req, reply) => {
    const params = z
      .object({chainId: z.coerce.number(), packId: z.string(), version: z.string()})
      .parse(req.params);

    const row = await queryOne<{pool_cid: string; ipfs_pins: string[]; arweave_tx: string | null; merkle_root: string}>(
      `SELECT pool_cid, ipfs_pins, arweave_tx, merkle_root FROM pool_versions
        WHERE chain_id = $1 AND pack_id = $2 AND version = $3`,
      [params.chainId, params.packId as Hex, params.version],
    );
    if (!row) return reply.code(404).send({error: 'unknown_pool_version'});

    return reply.send({
      poolCid: row.pool_cid,
      merkleRoot: row.merkle_root,
      gateways: [
        `https://ipfs.io/ipfs/${row.pool_cid}`,
        `https://cloudflare-ipfs.com/ipfs/${row.pool_cid}`,
        ...(row.arweave_tx ? [`${config.ARWEAVE_GATEWAY}/${row.arweave_tx}`] : []),
      ],
      pins: row.ipfs_pins,
      note:
        'Hash this CID with keccak256 and compare it to poolCID in getPoolVersion() on-chain. Then rebuild ' +
        'the Merkle root from the file and compare it to the root on-chain. If both match, the odds you ' +
        'were shown are the odds that were committed.',
    });
  });
}

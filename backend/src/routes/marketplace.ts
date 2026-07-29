import type {FastifyInstance} from 'fastify';
import {isAddress, type Address, type Hex} from 'viem';
import {z} from 'zod';
import {getChain, allChains, isChainServed} from '../chains.js';
import {marketplaceAbi, collectibleAbi} from '../lib/abi.js';
import {marketplaceDomain, listingTypes, offerTypes} from '../lib/eip712.js';
import {requireSession} from '../services/auth.js';
import {query, queryOne} from '../db/index.js';

/**
 * Marketplace order book (spec §5.6).
 *
 * The important thing about these endpoints is how little authority they have. An order is a signed
 * EIP-712 payload; the buyer fills it by calling `Marketplace.buy` **from their own wallet**, and the
 * contract re-verifies the maker's signature, the expiry, the nonce and the fee/royalty split.
 *
 * So this service is a discovery index, not a custodian and not an escrow. It never holds a card,
 * never holds funds, and cannot alter a price — the price is inside the signature. If this database
 * were wiped, every outstanding order would still be fillable by anyone holding a copy of it, and if
 * a row were tampered with, the fill would simply revert.
 *
 * Note also that there is no relayer here, unlike `rip`. A marketplace trade is not a random-outcome
 * money action, so it carries no jurisdiction gate — and that means no reason to route it through us.
 */

const orderSchema = z.object({
  chainId: z.number().int().positive(),
  kind: z.enum(['listing', 'offer']),
  maker: z.string().refine(isAddress),
  tokenId: z.string().regex(/^\d+$/),
  price: z.string().regex(/^\d+$/),
  payToken: z.string().refine(isAddress),
  nonce: z.string().regex(/^\d+$/),
  expiry: z.number().int().positive(),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

interface ListingRow {
  id: string;
  chain_id: string;
  kind: string;
  maker: string;
  token_id: string;
  price: string;
  pay_token: string;
  nonce: string;
  expiry: string;
  signature: string;
  order_hash: string;
  status: string;
  name: string | null;
  set_name: string | null;
  year: number | null;
  grade: string | null;
  image_url: string | null;
}

export async function marketplaceRoutes(app: FastifyInstance): Promise<void> {
  /** The typed-data payload a maker must sign. Returned so the UI never hand-builds it. */
  app.post('/listings/prepare', async (req, reply) => {
    const session = await requireSession(req);
    const body = z
      .object({
        chainId: z.number().int().positive(),
        kind: z.enum(['listing', 'offer']),
        tokenId: z.string().regex(/^\d+$/),
        price: z.string().regex(/^\d+$/),
        expiryHours: z.number().int().min(1).max(24 * 30).default(24 * 7),
      })
      .parse(req.body);

    const chain = getChain(body.chainId);
    const payToken = Object.values(chain.payTokens)[0];
    if (!payToken) return reply.code(400).send({error: 'no_pay_token_configured'});

    if (body.kind === 'listing') {
      const owner = await chain.client.readContract({
        address: chain.deployment.collectibleNFT,
        abi: collectibleAbi,
        functionName: 'ownerOf',
        args: [BigInt(body.tokenId)],
      });
      if (owner.toLowerCase() !== session.address) {
        return reply.code(403).send({error: 'not_token_owner', detail: 'You do not own this card.'});
      }
    }

    // A random nonce rather than a counter: orders are independent, so a sequential nonce would make
    // two concurrent listings collide for no reason. The contract only requires uniqueness per maker.
    const nonce = BigInt(`0x${Buffer.from(crypto.getRandomValues(new Uint8Array(8))).toString('hex')}`);
    const expiry = Math.floor(Date.now() / 1000) + body.expiryHours * 3600;

    return reply.send({
      typedData: {
        domain: marketplaceDomain(chain),
        types: body.kind === 'listing' ? listingTypes : offerTypes,
        primaryType: body.kind === 'listing' ? 'Listing' : 'Offer',
        message: {
          maker: session.address,
          tokenId: body.tokenId,
          price: body.price,
          payToken,
          nonce: nonce.toString(),
          expiry,
        },
      },
      // The buyer needs both to fill: who to approve, and who to call.
      marketplace: chain.deployment.marketplace,
      paymentRouter: chain.deployment.paymentRouter,
      payToken,
    });
  });

  /** Publishes a signed order to the index. */
  app.post('/listings', {config: {rateLimit: {max: 30, timeWindow: '1 minute'}}}, async (req, reply) => {
    const session = await requireSession(req);
    const body = orderSchema.parse(req.body);

    if (body.maker.toLowerCase() !== session.address) {
      return reply.code(403).send({error: 'maker_mismatch'});
    }

    const chain = getChain(body.chainId);
    const order = {
      maker: body.maker as Address,
      tokenId: BigInt(body.tokenId),
      price: BigInt(body.price),
      payToken: body.payToken as Address,
      nonce: BigInt(body.nonce),
      expiry: body.expiry,
    };

    // Ask the CONTRACT for the hash rather than recomputing it here. If our idea of the order differs
    // from its idea by even one field, this is where it surfaces — not on a failed fill.
    const orderHash = await chain.client.readContract({
      address: chain.deployment.marketplace,
      abi: marketplaceAbi,
      functionName: body.kind === 'listing' ? 'hashListing' : 'hashOffer',
      args: [order],
    });

    await query(
      `INSERT INTO listings (chain_id, kind, maker, token_id, price, pay_token, nonce, expiry, signature, order_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (chain_id, maker, nonce) DO NOTHING`,
      [
        body.chainId,
        body.kind,
        body.maker.toLowerCase(),
        body.tokenId,
        body.price,
        body.payToken,
        body.nonce,
        body.expiry,
        body.signature,
        orderHash,
      ],
    );

    return reply.send({orderHash, marketplace: chain.deployment.marketplace});
  });

  /** Browse. Everything needed to fill an order is returned, because the fill happens client-side. */
  app.get('/listings', async (req, reply) => {
    const q = z
      .object({
        chainId: z.coerce.number().int().positive().optional(),
        kind: z.enum(['listing', 'offer']).default('listing'),
        maker: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(req.query);

    const rows = await query<ListingRow>(
      `SELECT l.*, n.name, n.set_name, n.year, n.grade, n.image_url
         FROM listings l
         LEFT JOIN nfts n ON n.chain_id = l.chain_id AND n.token_id = l.token_id
        WHERE l.status = 'open'
          AND l.kind = $1
          AND l.expiry > EXTRACT(EPOCH FROM now())
          AND ($2::bigint IS NULL OR l.chain_id = $2)
          AND ($3::text IS NULL OR l.maker = lower($3))
        ORDER BY l.created_at DESC
        LIMIT $4`,
      [q.kind, q.chainId ?? null, q.maker ?? null, q.limit],
    );

    return reply.send(
      rows.filter((r) => isChainServed(Number(r.chain_id))).map((r) => {
        const chain = getChain(Number(r.chain_id));
        return {
          id: r.id,
          chainId: Number(r.chain_id),
          kind: r.kind,
          orderHash: r.order_hash,
          marketplace: chain.deployment.marketplace,
          paymentRouter: chain.deployment.paymentRouter,
          // Exactly the tuple `Marketplace.buy` expects, plus the signature.
          order: {
            maker: r.maker,
            tokenId: r.token_id,
            price: r.price,
            payToken: r.pay_token,
            nonce: r.nonce,
            expiry: Number(r.expiry),
          },
          signature: r.signature,
          card: {
            tokenId: r.token_id,
            name: r.name ?? `Card #${r.token_id}`,
            setName: r.set_name,
            year: r.year,
            grade: r.grade ?? 'Ungraded',
            imageUrl: r.image_url ?? '/chari.png',
          },
        };
      }),
    );
  });

  /**
   * Removes an order from the index.
   *
   * This is discovery only — it does NOT invalidate the signature. A buyer who already holds a copy
   * could still fill it, so the UI tells the maker to cancel on-chain (`cancel` or `bumpMinNonce`)
   * when they mean it irrevocably.
   */
  app.delete('/listings/:id', async (req, reply) => {
    const session = await requireSession(req);
    const {id} = z.object({id: z.string().regex(/^\d+$/)}).parse(req.params);

    const row = await queryOne<{maker: string}>('SELECT maker FROM listings WHERE id = $1', [id]);
    if (!row) return reply.code(404).send({error: 'unknown_listing'});
    if (row.maker !== session.address) return reply.code(403).send({error: 'not_your_listing'});

    await query(`UPDATE listings SET status = 'cancelled', updated_at = now() WHERE id = $1`, [id]);
    return reply.send({
      ok: true,
      note:
        'Removed from the marketplace index. The signature itself is still valid — call cancel() or ' +
        'bumpMinNonce() on the Marketplace contract to revoke it irrevocably.',
    });
  });

  /** The signed-in user's cards, read from chain ownership rather than our cache. */
  app.get('/me/cards', async (req, reply) => {
    const session = await requireSession(req);

    const rows = await query<{
      chain_id: string;
      token_id: string;
      name: string | null;
      set_name: string | null;
      year: number | null;
      grade: string | null;
      image_url: string | null;
    }>(
      `SELECT chain_id, token_id, name, set_name, year, grade, image_url
         FROM nfts WHERE owner = $1 AND location = 'user' ORDER BY token_id`,
      [session.address],
    );

    const cards = [];
    for (const row of rows) {
      const chain = getChain(Number(row.chain_id));
      // The indexer's cache can lag a block; ownership is the one thing worth re-reading from chain,
      // because offering to list a card the user no longer holds wastes a signature and a gas fee.
      const owner = await chain.client.readContract({
        address: chain.deployment.collectibleNFT,
        abi: collectibleAbi,
        functionName: 'ownerOf',
        args: [BigInt(row.token_id)],
      });
      if (owner.toLowerCase() !== session.address) continue;

      const listed = await queryOne<{id: string; price: string}>(
        `SELECT id, price FROM listings
          WHERE chain_id = $1 AND token_id = $2 AND status = 'open' AND kind = 'listing'`,
        [row.chain_id, row.token_id],
      );

      cards.push({
        chainId: Number(row.chain_id),
        tokenId: row.token_id,
        name: row.name ?? `Card #${row.token_id}`,
        setName: row.set_name,
        year: row.year,
        grade: row.grade ?? 'Ungraded',
        imageUrl: row.image_url ?? '/chari.png',
        collectibleNFT: chain.deployment.collectibleNFT,
        marketplace: chain.deployment.marketplace,
        listing: listed ? {id: listed.id, price: listed.price} : null,
      });
    }

    return reply.send(cards);
  });

  /**
   * A single card: its grading identity, where it is, and its trading history.
   * Ownership and redemption come from chain state; the rest is the indexer's cache.
   */
  app.get('/cards/:chainId/:tokenId', async (req, reply) => {
    const params = z
      .object({chainId: z.coerce.number().int().positive(), tokenId: z.string().regex(/^\d+$/)})
      .parse(req.params);

    const chain = getChain(params.chainId);
    const card = await queryOne<{
      token_id: string;
      cert_number: string;
      grade: string;
      grading_co: string;
      commitment: string;
      name: string | null;
      set_name: string | null;
      year: number | null;
      image_url: string | null;
      location: string;
      owner: string | null;
    }>('SELECT * FROM nfts WHERE chain_id = $1 AND token_id = $2', [params.chainId, params.tokenId]);

    if (!card) return reply.code(404).send({error: 'unknown_card'});

    let owner: string | null = card.owner;
    let redeemed = false;
    if (card.location !== 'redeemed') {
      try {
        owner = await chain.client.readContract({
          address: chain.deployment.collectibleNFT,
          abi: collectibleAbi,
          functionName: 'ownerOf',
          args: [BigInt(params.tokenId)],
        });
      } catch {
        // `ownerOf` reverts for a burned token, which is exactly what redemption does.
        redeemed = true;
      }
    } else {
      redeemed = true;
    }

    const [listing, history, priceRef] = await Promise.all([
      queryOne<{id: string; price: string; maker: string; nonce: string; expiry: string; signature: string; pay_token: string}>(
        `SELECT id, price, maker, nonce, expiry, signature, pay_token FROM listings
          WHERE chain_id = $1 AND token_id = $2 AND status = 'open' AND kind = 'listing'`,
        [params.chainId, params.tokenId],
      ),
      query<{price: string; filled_by: string; filled_tx: string; updated_at: Date; maker: string}>(
        `SELECT price, filled_by, filled_tx, updated_at, maker FROM listings
          WHERE chain_id = $1 AND token_id = $2 AND status = 'filled'
          ORDER BY updated_at DESC LIMIT 20`,
        [params.chainId, params.tokenId],
      ),
      queryOne<{price_ref: string}>(
        `SELECT price_ref FROM pool_leaves WHERE chain_id = $1 AND token_id = $2
          ORDER BY version DESC LIMIT 1`,
        [params.chainId, params.tokenId],
      ),
    ]);

    return reply.send({
      chainId: params.chainId,
      tokenId: card.token_id,
      name: card.name ?? `Card #${card.token_id}`,
      setName: card.set_name,
      year: card.year,
      imageUrl: card.image_url ?? '/chari.png',
      grading: {
        company: card.grading_co,
        grade: card.grade,
        certNumber: card.cert_number,
        // The on-chain commitment binds this certificate to this token forever.
        commitment: card.commitment,
      },
      // Reference value from the pool it was drawn from — a committed figure, not a live quote.
      insuredValue: priceRef?.price_ref ?? null,
      owner,
      redeemed,
      inVault: card.location === 'vault',
      collectibleNFT: chain.deployment.collectibleNFT,
      explorer: chain.explorer ? `${chain.explorer}/token/${chain.deployment.collectibleNFT}?a=${card.token_id}` : null,
      listing: listing
        ? {
            id: listing.id,
            price: listing.price,
            marketplace: chain.deployment.marketplace,
            paymentRouter: chain.deployment.paymentRouter,
            signature: listing.signature,
            order: {
              maker: listing.maker,
              tokenId: card.token_id,
              price: listing.price,
              payToken: listing.pay_token,
              nonce: listing.nonce,
              expiry: Number(listing.expiry),
            },
          }
        : null,
      history: history.map((h) => ({
        price: h.price,
        seller: h.maker,
        buyer: h.filled_by,
        txHash: h.filled_tx,
        at: h.updated_at,
      })),
    });
  });

  /** A public profile: what this address owns, and what it has done. */
  app.get('/users/:address', async (req, reply) => {
    const {address} = z.object({address: z.string().refine(isAddress)}).parse(req.params);
    const user = address.toLowerCase();

    const [cards, draws, trades] = await Promise.all([
      query<{chain_id: string; token_id: string; name: string | null; grade: string | null; image_url: string | null; set_name: string | null; year: number | null}>(
        `SELECT chain_id, token_id, name, grade, image_url, set_name, year FROM nfts
          WHERE owner = $1 AND location = 'user' ORDER BY token_id`,
        [user],
      ),
      query<{chain_id: string; draw_id: string; status: string; created_at: Date}>(
        `SELECT chain_id, draw_id, status, created_at FROM draws
          WHERE user_address = $1 ORDER BY created_at DESC LIMIT 25`,
        [user],
      ),
      query<{price: string; token_id: string; maker: string; filled_by: string; updated_at: Date}>(
        `SELECT price, token_id, maker, filled_by, updated_at FROM listings
          WHERE status = 'filled' AND (maker = $1 OR filled_by = $1)
          ORDER BY updated_at DESC LIMIT 25`,
        [user],
      ),
    ]);

    // Insured value is the sum of committed reference prices, not a mark-to-market valuation — say so
    // rather than presenting a number that looks like a portfolio quote.
    let insuredValue = 0n;
    for (const card of cards) {
      const ref = await queryOne<{price_ref: string}>(
        `SELECT price_ref FROM pool_leaves WHERE chain_id = $1 AND token_id = $2 ORDER BY version DESC LIMIT 1`,
        [card.chain_id, card.token_id],
      );
      if (ref) insuredValue += BigInt(ref.price_ref);
    }

    return reply.send({
      address: user,
      cardCount: cards.length,
      insuredValue: insuredValue.toString(),
      insuredValueBasis: 'sum of committed reference prices, not a live market valuation',
      cards: cards.map((c) => ({
        chainId: Number(c.chain_id),
        tokenId: c.token_id,
        name: c.name ?? `Card #${c.token_id}`,
        setName: c.set_name,
        year: c.year,
        grade: c.grade ?? 'Ungraded',
        imageUrl: c.image_url ?? '/chari.png',
      })),
      draws: draws.map((d) => ({
        chainId: Number(d.chain_id),
        drawId: d.draw_id,
        status: d.status,
        at: d.created_at,
      })),
      trades: trades.map((t) => ({
        tokenId: t.token_id,
        price: t.price,
        side: t.maker === user ? 'sold' : 'bought',
        counterparty: t.maker === user ? t.filled_by : t.maker,
        at: t.updated_at,
      })),
    });
  });

  /**
   * Leaderboard: who holds the most, by committed reference value.
   *
   * Ranked on cards actually held on-chain rather than on a points system, because an invented score
   * is unverifiable and this product's entire pitch is that its numbers are checkable.
   */
  app.get('/leaderboard', async (req, reply) => {
    const q = z
      .object({
        chainId: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(25),
      })
      .parse(req.query);

    const rows = await query<{owner: string; card_count: string; reference_value: string}>(
      `SELECT n.owner,
              COUNT(*)::text AS card_count,
              COALESCE(SUM(ref.price_ref), 0)::text AS reference_value
         FROM nfts n
         LEFT JOIN LATERAL (
           SELECT price_ref FROM pool_leaves pl
            WHERE pl.chain_id = n.chain_id AND pl.token_id = n.token_id
            ORDER BY pl.version DESC LIMIT 1
         ) ref ON TRUE
        WHERE n.owner IS NOT NULL
          AND n.location = 'user'
          AND ($1::bigint IS NULL OR n.chain_id = $1)
        GROUP BY n.owner
        ORDER BY reference_value DESC, card_count DESC
        LIMIT $2`,
      [q.chainId ?? null, q.limit],
    );

    // Pack activity is a separate, honest metric: how many draws this address has resolved.
    const out = [];
    for (const [i, row] of rows.entries()) {
      const packs = await queryOne<{count: string}>(
        `SELECT COUNT(*)::text AS count FROM draws
          WHERE user_address = $1 AND status IN ('delivered','bought_back','compensated')`,
        [row.owner],
      );
      out.push({
        rank: i + 1,
        address: row.owner,
        cardCount: Number(row.card_count),
        referenceValue: row.reference_value,
        packsOpened: Number(packs?.count ?? 0),
      });
    }

    return reply.send({
      basis: 'cards held on-chain, valued at their committed reference prices',
      entries: out,
    });
  });

  /** Marketplace parameters, so the UI can show the fee before anyone signs anything. */
  app.get('/marketplace/config', async (_req, reply) => {
    const out = [];
    for (const chain of allChains()) {
      const feeBps = await chain.client.readContract({
        address: chain.deployment.marketplace,
        abi: marketplaceAbi,
        functionName: 'feeBps',
      });
      out.push({
        chainId: chain.chainId,
        marketplace: chain.deployment.marketplace,
        paymentRouter: chain.deployment.paymentRouter,
        collectibleNFT: chain.deployment.collectibleNFT,
        payTokens: chain.payTokens,
        feeBps,
      });
    }
    return reply.send(out);
  });
}

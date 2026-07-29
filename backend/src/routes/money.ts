import type {FastifyInstance} from 'fastify';
import {encodeFunctionData, isAddress, type Address, type Hex} from 'viem';
import {z} from 'zod';
import {getChain} from '../chains.js';
import {gachaAbi} from '../lib/abi.js';
import {requireSession} from '../services/auth.js';
import {checkBuybackAllowed, checkRipAllowed, recordDecision} from '../services/compliance.js';
import {getSigner} from '../services/signer.js';
import * as relayer from '../services/relayer.js';
import {buildLeafProof} from '../services/proofs.js';
import {buybackAuthTypes, buybackUserTypes, gachaDomain, purchaseAuthTypes} from '../lib/eip712.js';
import {query, queryOne} from '../db/index.js';
import {userActionKey, drawKey} from '../lib/idempotency.js';
import {logger} from '../lib/logger.js';

/**
 * The money endpoints (spec §5.3, §8.1, §12).
 *
 * The shape of the rip flow is deliberate and worth stating plainly:
 *
 *   1. `POST /rip/quote` — we run the compliance gate and hand back the EXACT terms the user must sign
 *      (pack, pool version, root, CID, price, nonce, deadline). Nothing is charged.
 *   2. the user signs that payload in their own wallet;
 *   3. `POST /rip` — we re-run the compliance gate (a quote is not a licence), then relay.
 *
 * Two independent authorisations then exist on-chain: the user's signature pins the odds version and
 * price so we cannot overcharge or move them to different odds, and our TRUSTED_RELAYER_ROLE is what
 * makes the jurisdiction gate enforceable — a user cannot bypass it by calling the contract directly.
 */

const quoteSchema = z.object({
  chainId: z.number().int().positive(),
  packId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  numRips: z.number().int().min(1).max(10),
});

const ripSchema = quoteSchema.extend({
  auth: z.object({
    user: z.string().refine(isAddress),
    packId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    poolVersion: z.string(),
    numRips: z.string(),
    payToken: z.string().refine(isAddress),
    amountPerRip: z.string(),
    nonce: z.string(),
    deadline: z.number().int(),
  }),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

const buybackSchema = z.object({
  chainId: z.number().int().positive(),
  drawId: z.string(),
  /** The user's signature over the payout WE quoted. Absent on the quote call. */
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(),
  acceptedPayout: z.string().optional(),
});

export async function moneyRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------------------------
  // Rip
  // -------------------------------------------------------------------------------------------

  app.post('/rip/quote', {config: {rateLimit: {max: 30, timeWindow: '1 minute'}}}, async (req, reply) => {
    const session = await requireSession(req);
    const body = quoteSchema.parse(req.body);
    const chain = getChain(body.chainId);

    if (!chain.gachaEnabled) {
      return reply.code(400).send({
        error: 'gacha_unavailable',
        detail: `${chain.name} is marketplace-only: without Chainlink VRF there is no provably-fair draw here.`,
      });
    }

    // Gate at the money action, on verified jurisdiction — not at login, not on IP alone (§12).
    const decision = await checkRipAllowed({
      user: session.address,
      ip: req.ip,
      ipCountry: (req.headers['cf-ipcountry'] as string | undefined) ?? undefined,
    });
    await recordDecision({user: session.address, action: 'rip_quote', decision, ip: req.ip});
    if (!decision.allowed) {
      return reply.code(403).send({error: decision.reason, detail: decision.detail});
    }

    const packId = body.packId as Hex;
    const version = await chain.client.readContract({
      address: chain.deployment.gachaMachine,
      abi: gachaAbi,
      functionName: 'activePoolVersion',
      args: [packId],
    });
    if (version === 0n) return reply.code(404).send({error: 'pack_not_active'});

    const [pool, nonce] = await Promise.all([
      chain.client.readContract({
        address: chain.deployment.gachaMachine,
        abi: gachaAbi,
        functionName: 'getPoolVersion',
        args: [packId, version],
      }),
      chain.client.readContract({
        address: chain.deployment.gachaMachine,
        abi: gachaAbi,
        functionName: 'nonces',
        args: [session.address as Address],
      }),
    ]);

    const cid = await queryOne<{pool_cid: string}>(
      'SELECT pool_cid FROM pool_versions WHERE chain_id = $1 AND pack_id = $2 AND version = $3',
      [chain.chainId, packId, version.toString()],
    );

    const deadline = Math.floor(Date.now() / 1000) + 900;

    return reply.send({
      // Everything below is what the user is agreeing to. §12 requires the odds a user is buying to be
      // shown at the moment of purchase, so the exact version, root, total weight and CID are part of
      // the quote rather than a link somewhere else.
      terms: {
        chainId: chain.chainId,
        packId,
        poolVersion: version.toString(),
        merkleRoot: pool.root,
        poolCid: cid?.pool_cid ?? null,
        totalWeight: pool.totalWeight.toString(),
        pricePerRip: pool.pricePerRip.toString(),
        payToken: pool.payToken,
        // The user must allow this contract to pull `totalCost`. Returned here so the frontend does
        // not have to hardcode it or guess which of the suite's addresses does the pulling.
        paymentRouter: chain.deployment.paymentRouter,
        buybackBps: pool.buybackBps,
        numRips: body.numRips,
        totalCost: (pool.pricePerRip * BigInt(body.numRips)).toString(),
      },
      typedData: {
        domain: gachaDomain(chain),
        types: purchaseAuthTypes,
        primaryType: 'PurchaseAuth',
        message: {
          user: session.address,
          packId,
          poolVersion: version.toString(),
          numRips: String(body.numRips),
          payToken: pool.payToken,
          amountPerRip: pool.pricePerRip.toString(),
          nonce: nonce.toString(),
          deadline,
        },
      },
      jurisdiction: decision.jurisdiction,
    });
  });

  app.post('/rip', {config: {rateLimit: {max: 10, timeWindow: '1 minute'}}}, async (req, reply) => {
    const session = await requireSession(req);
    const body = ripSchema.parse(req.body);
    const chain = getChain(body.chainId);

    if (body.auth.user.toLowerCase() !== session.address) {
      return reply.code(403).send({error: 'signature_user_mismatch'});
    }

    // Re-run the gate: a quote is not a licence, and the user's status may have changed since.
    const decision = await checkRipAllowed({
      user: session.address,
      ip: req.ip,
      ipCountry: (req.headers['cf-ipcountry'] as string | undefined) ?? undefined,
    });
    await recordDecision({user: session.address, action: 'rip', decision, ip: req.ip});
    if (!decision.allowed) return reply.code(403).send({error: decision.reason, detail: decision.detail});

    const auth = {
      user: body.auth.user as Address,
      packId: body.auth.packId as Hex,
      poolVersion: BigInt(body.auth.poolVersion),
      numRips: BigInt(body.auth.numRips),
      payToken: body.auth.payToken as Address,
      amountPerRip: BigInt(body.auth.amountPerRip),
      nonce: BigInt(body.auth.nonce),
      deadline: body.auth.deadline,
    };

    const data = encodeFunctionData({
      abi: gachaAbi,
      functionName: 'rip',
      args: [auth, body.signature as Hex, {nonce: 0n, deadline: 0n, signature: '0x'}],
    });

    const key = userActionKey(chain.chainId, auth.user, auth.nonce, 'rip');
    const result = await relayer.send({
      chainId: chain.chainId,
      role: 'relayer',
      to: chain.deployment.gachaMachine,
      data,
      idempotencyKey: key,
      kind: 'rip',
      // Simulating first means a compliance-clean but on-chain-invalid rip (stale version, unbacked
      // reserve, depleted pool) returns a 4xx instead of costing the user a reverted transaction.
      simulate: async () => {
        await chain.client.simulateContract({
          address: chain.deployment.gachaMachine,
          abi: gachaAbi,
          functionName: 'rip',
          args: [auth, body.signature as Hex, {nonce: 0n, deadline: 0n, signature: '0x'}],
          account: getSigner('relayer').account,
        });
      },
    });

    if (!result) return reply.code(409).send({error: 'rip_already_in_flight'});

    // Record the jurisdiction decision against the draws this rip creates (§12 audit requirement).
    await query(
      `INSERT INTO audit_log (actor, action, target, after_val, ip)
       VALUES ($1, 'rip.submitted', $2, $3, $4)`,
      [
        session.address,
        result.txHash,
        JSON.stringify({jurisdiction: decision.jurisdiction, numRips: body.auth.numRips}),
        req.ip,
      ],
    );

    return reply.send({txHash: result.txHash, deduplicated: result.deduplicated});
  });

  // -------------------------------------------------------------------------------------------
  // Buyback
  // -------------------------------------------------------------------------------------------

  /**
   * Quotes a buyback. The payout we offer is bounded by the drawn card's committed `priceRef`, so the
   * quote can never exceed what the contract would accept — the on-chain cap is the backstop, not the
   * primary control, and the two agreeing is the point.
   */
  app.post('/buyback/quote', {config: {rateLimit: {max: 20, timeWindow: '1 minute'}}}, async (req, reply) => {
    const session = await requireSession(req);
    const body = buybackSchema.parse(req.body);
    const chain = getChain(body.chainId);

    const allowed = await checkBuybackAllowed(session.address);
    if (!allowed.allowed) {
      return reply.code(403).send({error: allowed.reason, detail: allowed.detail});
    }

    const drawId = BigInt(body.drawId);
    const draw = await chain.client.readContract({
      address: chain.deployment.gachaMachine,
      abi: gachaAbi,
      functionName: 'getDraw',
      args: [drawId],
    });

    if (draw.user.toLowerCase() !== session.address) return reply.code(403).send({error: 'not_your_draw'});
    if (!draw.revealed) return reply.code(409).send({error: 'draw_not_revealed'});
    if (draw.settled) return reply.code(409).send({error: 'draw_already_resolved'});

    const [pool, window] = await Promise.all([
      chain.client.readContract({
        address: chain.deployment.gachaMachine,
        abi: gachaAbi,
        functionName: 'getPoolVersion',
        args: [draw.packId, draw.poolVersion],
      }),
      chain.client.readContract({
        address: chain.deployment.gachaMachine,
        abi: gachaAbi,
        functionName: 'buybackWindow',
      }),
    ]);

    const proof = await buildLeafProof({
      chainId: chain.chainId,
      packId: draw.packId,
      version: draw.poolVersion,
      winningWeight: draw.winningWeight,
    });

    const cap = (proof.priceRef * BigInt(pool.buybackBps)) / 10_000n;
    const nonce = await chain.client.readContract({
      address: chain.deployment.gachaMachine,
      abi: gachaAbi,
      functionName: 'nonces',
      args: [session.address as Address],
    });
    const deadline = Math.floor(Date.now() / 1000) + 600;
    const expiresAt = Number(draw.revealedAt) + Number(window);

    return reply.send({
      drawId: body.drawId,
      tokenId: proof.tokenId.toString(),
      priceRef: proof.priceRef.toString(),
      buybackBps: pool.buybackBps,
      payout: cap.toString(),
      payToken: pool.payToken,
      windowExpiresAt: expiresAt,
      typedData: {
        domain: gachaDomain(chain),
        types: buybackUserTypes,
        primaryType: 'BuybackUser',
        message: {
          drawId: drawId.toString(),
          payToken: pool.payToken,
          payout: cap.toString(),
          nonce: nonce.toString(),
          deadline,
        },
      },
    });
  });

  app.post('/buyback', {config: {rateLimit: {max: 5, timeWindow: '1 minute'}}}, async (req, reply) => {
    const session = await requireSession(req);
    const body = buybackSchema.parse(req.body);
    if (!body.signature || !body.acceptedPayout) {
      return reply.code(400).send({error: 'signature_and_payout_required'});
    }

    const chain = getChain(body.chainId);
    const allowed = await checkBuybackAllowed(session.address);
    if (!allowed.allowed) return reply.code(403).send({error: allowed.reason, detail: allowed.detail});

    const drawId = BigInt(body.drawId);
    const draw = await chain.client.readContract({
      address: chain.deployment.gachaMachine,
      abi: gachaAbi,
      functionName: 'getDraw',
      args: [drawId],
    });
    if (draw.user.toLowerCase() !== session.address) return reply.code(403).send({error: 'not_your_draw'});

    const pool = await chain.client.readContract({
      address: chain.deployment.gachaMachine,
      abi: gachaAbi,
      functionName: 'getPoolVersion',
      args: [draw.packId, draw.poolVersion],
    });
    const proof = await buildLeafProof({
      chainId: chain.chainId,
      packId: draw.packId,
      version: draw.poolVersion,
      winningWeight: draw.winningWeight,
    });

    const cap = (proof.priceRef * BigInt(pool.buybackBps)) / 10_000n;
    const payout = BigInt(body.acceptedPayout);
    if (payout > cap) return reply.code(400).send({error: 'payout_above_cap', cap: cap.toString()});

    const nonce = await chain.client.readContract({
      address: chain.deployment.gachaMachine,
      abi: gachaAbi,
      functionName: 'nonces',
      args: [session.address as Address],
    });
    const deadline = Math.floor(Date.now() / 1000) + 600;

    const message = {
      drawId,
      payToken: pool.payToken,
      payout,
      nonce,
      deadline,
    };

    // The oracle signature is produced here, by a key whose ONLY power is signing this payload. It
    // cannot submit anything; the buyback relayer, which can, cannot produce this signature.
    const oracleSig = await getSigner('oracle').signTypedData({
      domain: gachaDomain(chain),
      types: buybackAuthTypes as never,
      primaryType: 'BuybackAuth',
      message: {
        drawId: message.drawId,
        payToken: message.payToken,
        payout: message.payout,
        nonce: message.nonce,
        deadline: message.deadline,
      },
    });

    const data = encodeFunctionData({
      abi: gachaAbi,
      functionName: 'settleBuyback',
      args: [drawId, message, body.signature as Hex, oracleSig, proof],
    });

    const result = await relayer.send({
      chainId: chain.chainId,
      role: 'buyback',
      to: chain.deployment.gachaMachine,
      data,
      idempotencyKey: drawKey(chain.chainId, drawId, 'buyback'),
      kind: 'buyback',
    });

    if (!result) return reply.code(409).send({error: 'buyback_already_in_flight'});
    logger.info({drawId: body.drawId, payout: payout.toString()}, 'buyback submitted');
    return reply.send({txHash: result.txHash});
  });

  /**
   * Delivers a revealed draw to its owner now, rather than at the end of the buyback window.
   *
   * Without this, choosing to keep a card was not an action at all — it closed the dialog and left
   * the draw for the settler worker to pick up once the window elapsed, so for several minutes the
   * card was neither in the vault as far as the user was concerned nor in their collection. The
   * contract permits `settle` inside the window for the draw's own user (or the relayer acting for
   * them), so there was never a reason to make them wait.
   *
   * This is a convenience and nothing more: `claimAfterTimeout` still lets anyone deliver the draw
   * once the window passes, with or without this service.
   */
  app.post('/draws/:drawId/settle', {config: {rateLimit: {max: 20, timeWindow: '1 minute'}}}, async (req, reply) => {
    const session = await requireSession(req);
    const params = z.object({drawId: z.string().regex(/^\d+$/)}).parse(req.params);
    const {chainId} = z.object({chainId: z.coerce.number().int().positive()}).parse(req.query);

    const chain = getChain(chainId);
    const drawId = BigInt(params.drawId);

    const draw = await chain.client.readContract({
      address: chain.deployment.gachaMachine,
      abi: gachaAbi,
      functionName: 'getDraw',
      args: [drawId],
    });
    if (draw.user.toLowerCase() !== session.address) return reply.code(403).send({error: 'not_your_draw'});
    if (!draw.revealed) return reply.code(409).send({error: 'draw_not_revealed'});
    if (draw.settled) return reply.code(409).send({error: 'draw_already_settled'});

    const proof = await buildLeafProof({
      chainId: chain.chainId,
      packId: draw.packId,
      version: draw.poolVersion,
      winningWeight: draw.winningWeight,
    });

    // The drawn card can already have gone to an earlier draw. That path pays the user from the
    // reservation booked at rip time instead of delivering, and is the same choice the settler
    // worker makes — keep the two in step so a manual keep and an automatic one cannot diverge.
    const held = await chain.client.readContract({
      address: chain.deployment.vault,
      abi: [
        {
          type: 'function',
          name: 'isHeld',
          stateMutability: 'view',
          inputs: [{type: 'uint256'}],
          outputs: [{type: 'bool'}],
        },
      ] as const,
      functionName: 'isHeld',
      args: [proof.tokenId],
    });
    const fn = held ? 'settle' : 'claimUnavailable';

    const result = await relayer.send({
      chainId: chain.chainId,
      role: 'relayer',
      to: chain.deployment.gachaMachine,
      data: encodeFunctionData({abi: gachaAbi, functionName: fn, args: [drawId, proof]}),
      idempotencyKey: drawKey(chain.chainId, drawId, fn),
      kind: fn,
    });

    if (!result) return reply.code(409).send({error: 'settle_already_in_flight'});
    logger.info({drawId: params.drawId, fn}, 'draw settled on request');
    return reply.send({txHash: result.txHash, tokenId: proof.tokenId.toString(), delivered: held});
  });
}

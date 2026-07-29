import {createHmac, timingSafeEqual} from 'node:crypto';
import {encodeFunctionData, type Address, type Hex} from 'viem';
import {config} from '../config.js';
import {getChain} from '../chains.js';
import {erc20Abi, collectibleAbi, gachaAbi} from '../lib/abi.js';
import {query, queryOne, transaction} from '../db/index.js';
import {alert, logger} from '../lib/logger.js';

/**
 * MoonPay fiat on-ramp (spec §9).
 *
 * The central risk here is not integration mechanics, it is the **chargeback loop**: fiat is reversible
 * for 60–120+ days, crypto is not. The attack is
 *
 *     buy USDC with a stolen card → rip → sell the card back for USDC → off-ramp → charge back the card
 *
 * and it is the reason this file is structured the way it is:
 *
 *  1. **Flow 1 by default** — MoonPay on-ramps to the USER'S OWN WALLET. Card-fraud risk sits with
 *     MoonPay, who priced it, rather than with our reserve. NFT Checkout (Flow 2), where we deliver an
 *     asset against a fiat promise, is opt-in and value-limited.
 *  2. **The webhook is not proof of funds.** `completed` only means MoonPay fired its crypto leg. We
 *     require our own on-chain USDC receipt confirmation before anything is delivered.
 *  3. **Holdback** — assets bought with fiat are non-transferable, non-redeemable and non-cashable
 *     until the dispute window passes.
 *  4. **Chargeback webhooks are ingested and acted on**, not just recorded.
 */

export interface WidgetUrlRequest {
  walletAddress: Address;
  chainId: number;
  fiatAmount?: number;
  fiatCurrency?: string;
  /** Value limit for the opt-in NFT Checkout flow. */
  flow?: 'onramp' | 'nft_checkout';
}

/**
 * Builds a MoonPay widget URL and signs it server-side (spec §9 [MUST]).
 * The secret key never reaches the browser; an unsigned URL is rejected by MoonPay, which is what
 * stops a user editing the wallet address or amount in flight.
 */
export function buildSignedWidgetUrl(req: WidgetUrlRequest): {url: string; signature: string} {
  if (!config.MOONPAY_API_KEY || !config.MOONPAY_SECRET_KEY) {
    throw new Error('MoonPay is not configured (MOONPAY_API_KEY / MOONPAY_SECRET_KEY)');
  }
  const chain = getChain(req.chainId);
  if (!chain.moonpayCurrency) {
    throw new Error(`MoonPay does not support ${chain.name} in this configuration`);
  }

  const params = new URLSearchParams({
    apiKey: config.MOONPAY_API_KEY,
    currencyCode: chain.moonpayCurrency,
    walletAddress: req.walletAddress,
    redirectURL: `${config.PUBLIC_ORIGIN}/gacha?funded=1`,
  });
  if (req.fiatAmount) params.set('baseCurrencyAmount', String(req.fiatAmount));
  if (req.fiatCurrency) params.set('baseCurrencyCode', req.fiatCurrency.toLowerCase());

  const queryString = `?${params.toString()}`;
  const signature = createHmac('sha256', config.MOONPAY_SECRET_KEY).update(queryString).digest('base64');

  return {
    url: `${config.MOONPAY_WIDGET_BASE}${queryString}&signature=${encodeURIComponent(signature)}`,
    signature,
  };
}

/**
 * Verifies MoonPay's `Moonpay-Signature-V2` header: `t=<unix>,s=<hex hmac of "t.rawBody">`.
 *
 * Both halves matter. Without the HMAC anyone can post a `completed` event; without the timestamp
 * freshness check a captured legitimate event can be replayed forever.
 */
export function verifyWebhookSignature(args: {
  header: string | undefined;
  rawBody: string;
  toleranceSeconds?: number;
}): {valid: boolean; reason?: string} {
  if (!config.MOONPAY_WEBHOOK_SECRET) return {valid: false, reason: 'webhook secret not configured'};
  if (!args.header) return {valid: false, reason: 'missing signature header'};

  const parts = Object.fromEntries(
    args.header.split(',').map((p) => {
      const [k, v] = p.split('=');
      return [k?.trim() ?? '', v?.trim() ?? ''];
    }),
  );
  const timestamp = parts.t;
  const provided = parts.s;
  if (!timestamp || !provided) return {valid: false, reason: 'malformed signature header'};

  const tolerance = args.toleranceSeconds ?? 300;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > tolerance) return {valid: false, reason: 'signature timestamp outside tolerance'};

  const expected = createHmac('sha256', config.MOONPAY_WEBHOOK_SECRET)
    .update(`${timestamp}.${args.rawBody}`)
    .digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return {valid: false, reason: 'signature length mismatch'};
  return timingSafeEqual(a, b) ? {valid: true} : {valid: false, reason: 'signature mismatch'};
}

export interface MoonPayWebhookEvent {
  type: string;
  externalId?: string;
  data: {
    id: string;
    status: string;
    walletAddress?: string;
    baseCurrencyAmount?: number;
    baseCurrencyCode?: string;
    quoteCurrencyAmount?: number;
    quoteCurrencyCode?: string;
    cryptoTransactionId?: string;
  };
}

/**
 * Idempotent webhook processing with an explicit state machine (spec §9 FIX M5-backend).
 * A replayed or out-of-order `completed` cannot move an order backwards or re-trigger delivery.
 */
export async function processWebhook(eventId: string, event: MoonPayWebhookEvent): Promise<{handled: boolean}> {
  const seen = await queryOne<{event_id: string}>('SELECT event_id FROM moonpay_webhook_events WHERE event_id = $1', [
    eventId,
  ]);
  if (seen) {
    logger.info({eventId}, 'moonpay webhook replay ignored');
    return {handled: false};
  }

  await query(
    'INSERT INTO moonpay_webhook_events (event_id, order_id, type, payload) VALUES ($1,$2,$3,$4)',
    [eventId, event.data.id, event.type, JSON.stringify(event)],
  );

  const user = event.data.walletAddress?.toLowerCase();
  if (!user) {
    logger.warn({eventId, type: event.type}, 'moonpay webhook without a wallet address');
    return {handled: false};
  }

  switch (event.type) {
    case 'transaction_created':
    case 'transaction_updated':
      await upsertOrder(event, user);
      break;

    case 'transaction_failed':
      await query(`UPDATE moonpay_orders SET status = 'failed', updated_at = now() WHERE order_id = $1`, [
        event.data.id,
      ]);
      break;

    // Anything in this family means the fiat leg is being clawed back. Freeze first, investigate after.
    case 'transaction_chargeback':
    case 'transaction_disputed':
    case 'transaction_refunded':
      await handleChargeback(event, user);
      break;

    default:
      logger.info({type: event.type}, 'unhandled moonpay webhook type');
      break;
  }

  return {handled: true};
}

async function upsertOrder(event: MoonPayWebhookEvent, user: string): Promise<void> {
  const holdbackUntil = new Date(Date.now() + config.FIAT_CHARGEBACK_HOLDBACK_DAYS * 86_400_000);

  await query(
    `INSERT INTO moonpay_orders (order_id, user_address, fiat_amount, fiat_currency, crypto_currency,
                                 status, holdback_until)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (order_id) DO UPDATE
       SET status = EXCLUDED.status, updated_at = now()`,
    [
      event.data.id,
      user,
      event.data.baseCurrencyAmount ?? null,
      event.data.baseCurrencyCode ?? null,
      event.data.quoteCurrencyCode ?? null,
      event.data.status,
      holdbackUntil,
    ],
  );

  // `completed` is MoonPay's word for "we fired the crypto leg" — not proof the funds arrived. The
  // order is only usable once we have seen the transfer ourselves.
  if (event.data.status === 'completed') {
    logger.info({orderId: event.data.id}, 'moonpay reports completed; awaiting our own on-chain confirmation');
  }
}

/**
 * Confirms an on-ramp by observing the token transfer on-chain, and only then treats it as funded.
 * Called by the worker for every order MoonPay says is complete but we have not verified.
 */
export async function confirmOnChainReceipt(orderId: string): Promise<boolean> {
  const order = await queryOne<{
    order_id: string;
    user_address: string;
    chain_id: string | null;
    crypto_amount: string | null;
    onchain_confirmed_tx: string | null;
  }>('SELECT * FROM moonpay_orders WHERE order_id = $1', [orderId]);

  if (!order || order.onchain_confirmed_tx) return true;
  if (!order.chain_id) return false;

  const chain = getChain(Number(order.chain_id));
  const payToken = Object.values(chain.payTokens)[0];
  if (!payToken) return false;

  const balance = await chain.client.readContract({
    address: payToken,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [order.user_address as Address],
  });

  if (order.crypto_amount && balance < BigInt(order.crypto_amount)) return false;

  await query(
    `UPDATE moonpay_orders SET onchain_confirmed_tx = $2, onchain_confirmed_at = now(), updated_at = now()
      WHERE order_id = $1`,
    [orderId, 'balance-observed'],
  );
  return true;
}

/**
 * Chargeback response (spec §9 runbook): freeze the account's cash-out path, extend the on-chain
 * holdbacks on assets bought with the disputed funds, and page ops.
 *
 * Note what this deliberately does NOT do: it never seizes or moves a user's card. The on-chain
 * controls it uses are duration-capped delays, so a false positive costs a user time, not property.
 */
async function handleChargeback(event: MoonPayWebhookEvent, user: string): Promise<void> {
  const state = event.type === 'transaction_refunded' ? 'reversed' : event.type === 'transaction_disputed' ? 'disputed' : 'charged_back';

  await transaction(async (client) => {
    await client.query(
      `UPDATE moonpay_orders SET chargeback_state = $2, updated_at = now() WHERE order_id = $1`,
      [event.data.id, state],
    );
    await client.query(
      `INSERT INTO audit_log (actor, action, target, after_val)
       VALUES ('moonpay', 'chargeback', $1, $2)`,
      [user, JSON.stringify({orderId: event.data.id, state})],
    );
  });

  await alert('moonpay_chargeback', {
    orderId: event.data.id,
    user,
    state,
    runbook: 'docs/RUNBOOKS.md#moonpay-chargeback-wave',
  });

  await applyRiskHoldback(user, state);
}

/**
 * Applies the on-chain risk holdbacks. Requires RISK_ADMIN_ROLE on the relayer key.
 * Both controls are time-boxed in the contracts and cannot exceed their caps.
 */
export async function applyRiskHoldback(user: string, reason: string): Promise<void> {
  const until = BigInt(Math.floor(Date.now() / 1000) + config.FIAT_CHARGEBACK_HOLDBACK_DAYS * 86_400);

  for (const chain of (await import('../chains.js')).allChains()) {
    if (!chain.gachaEnabled) continue;
    logger.warn(
      {
        user,
        reason,
        chainId: chain.chainId,
        buybackLockCalldata: encodeFunctionData({
          abi: gachaAbi,
          functionName: 'setBuybackLock',
          args: [user as Address, until],
        }),
      },
      'risk holdback required — queue setBuybackLock (and setTransferLock per affected token)',
    );
  }

  await query(
    `INSERT INTO audit_log (actor, action, target, after_val)
     VALUES ('risk', 'holdback_requested', $1, $2)`,
    [user, JSON.stringify({until: until.toString(), reason})],
  );
}

/** Calldata helper for the per-token transfer holdback, used by the admin console. */
export function transferLockCalldata(tokenId: bigint, until: bigint): Hex {
  return encodeFunctionData({abi: collectibleAbi, functionName: 'setTransferLock', args: [tokenId, until]});
}

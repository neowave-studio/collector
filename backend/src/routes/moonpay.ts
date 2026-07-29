import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {isAddress, type Address} from 'viem';
import {buildSignedWidgetUrl, processWebhook, verifyWebhookSignature, type MoonPayWebhookEvent} from '../services/moonpay.js';
import {readSession} from '../services/auth.js';
import {alert, logger} from '../lib/logger.js';
import {config} from '../config.js';

/** Tracks webhook signature failures so a spike can page ops (spec §8.7). */
let signatureFailuresInWindow = 0;
let windowStartedAt = Date.now();

export async function moonpayRoutes(app: FastifyInstance): Promise<void> {
  const widgetSchema = z.object({
    chainId: z.number().int().positive(),
    fiatAmount: z.number().positive().optional(),
    fiatCurrency: z.string().length(3).optional(),
    flow: z.enum(['onramp', 'nft_checkout']).optional(),
  });

  /**
   * Signs a MoonPay widget URL for the authenticated wallet (spec §9 [MUST]).
   *
   * The wallet address comes from the SESSION, never from the request body — otherwise a user could
   * have someone else's card payment credited to their own wallet.
   */
  app.post('/moonpay/widget-url', {config: {rateLimit: {max: 10, timeWindow: '1 minute'}}}, async (req, reply) => {
    const session = await readSession(req);
    if (!session) return reply.code(401).send({error: 'authentication_required'});

    const body = widgetSchema.parse(req.body);

    // Flow 1 (on-ramp to the user's own wallet) is the default because it leaves card-fraud risk with
    // MoonPay, who priced it. Flow 2 delivers an asset against a still-reversible fiat promise, so it
    // stays opt-in and value-limited (spec §9 FIX C4-backend).
    if (body.flow === 'nft_checkout') {
      return reply.code(400).send({
        error: 'flow_not_enabled',
        detail:
          'NFT Checkout is disabled in this deployment. It hands us the chargeback risk directly, so it ' +
          'requires per-user value limits and a risk score before it can be enabled.',
      });
    }

    if (!isAddress(session.address)) return reply.code(400).send({error: 'invalid_wallet'});

    try {
      const {url} = buildSignedWidgetUrl({
        walletAddress: session.address as Address,
        chainId: body.chainId,
        ...(body.fiatAmount !== undefined ? {fiatAmount: body.fiatAmount} : {}),
        ...(body.fiatCurrency !== undefined ? {fiatCurrency: body.fiatCurrency} : {}),
      });
      return reply.send({
        url,
        holdbackDays: config.FIAT_CHARGEBACK_HOLDBACK_DAYS,
        notice:
          `Cards bought with a card payment can be kept or redeemed immediately, but cannot be sold back ` +
          `for ${config.FIAT_CHARGEBACK_HOLDBACK_DAYS} days, until the payment can no longer be reversed.`,
      });
    } catch (err) {
      return reply.code(503).send({error: 'moonpay_unavailable', detail: (err as Error).message});
    }
  });

  /**
   * Webhook receiver.
   *
   * Every event is HMAC-verified against the RAW body — parsing first and re-serialising would change
   * the bytes and break the signature, so the route is registered with a raw-body parser.
   */
  app.post(
    '/moonpay/webhook',
    {config: {rawBody: true, rateLimit: {max: 200, timeWindow: '1 minute'}}},
    async (req, reply) => {
      const raw = (req as unknown as {rawBody?: string}).rawBody ?? JSON.stringify(req.body);
      const header = req.headers['moonpay-signature-v2'] as string | undefined;

      const verdict = verifyWebhookSignature({header, rawBody: raw});
      if (!verdict.valid) {
        await noteSignatureFailure(verdict.reason ?? 'unknown');
        return reply.code(401).send({error: 'invalid_signature'});
      }

      const event = req.body as MoonPayWebhookEvent;
      const eventId = (req.headers['moonpay-event-id'] as string | undefined) ?? `${event.type}:${event.data?.id}`;

      try {
        const result = await processWebhook(eventId, event);
        return reply.send({received: true, handled: result.handled});
      } catch (err) {
        logger.error({err, eventId}, 'moonpay webhook processing failed');
        // 500 makes MoonPay retry, which is what we want: dropping a chargeback event silently is far
        // worse than processing it twice (processing is idempotent on eventId).
        return reply.code(500).send({error: 'processing_failed'});
      }
    },
  );
}

async function noteSignatureFailure(reason: string): Promise<void> {
  const now = Date.now();
  if (now - windowStartedAt > 60_000) {
    signatureFailuresInWindow = 0;
    windowStartedAt = now;
  }
  signatureFailuresInWindow += 1;

  logger.warn({reason, count: signatureFailuresInWindow}, 'moonpay webhook signature verification failed');

  // A burst of failed signatures is either a misconfigured secret or someone probing the endpoint with
  // forged `completed` events. Both need a human (spec §8.7).
  if (signatureFailuresInWindow === 5) {
    await alert('moonpay_webhook_signature_failure_spike', {reason, windowSeconds: 60, count: 5});
  }
}

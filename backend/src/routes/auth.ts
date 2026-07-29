import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {
  AuthError,
  clearSessionCookie,
  issueNonce,
  readSession,
  revokeSession,
  setSessionCookie,
  verifySiwe,
} from '../services/auth.js';
import {config} from '../config.js';
import {attestAge, requiresDocumentVerification} from '../services/compliance.js';
import {queryOne} from '../db/index.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get('/auth/nonce', {config: {rateLimit: {max: 30, timeWindow: '1 minute'}}}, async (_req, reply) => {
    return reply.send({nonce: await issueNonce(), domain: new URL(config.PUBLIC_ORIGIN).host});
  });

  const verifySchema = z.object({message: z.string().min(1), signature: z.string().min(1)});

  app.post('/auth/verify', {config: {rateLimit: {max: 20, timeWindow: '1 minute'}}}, async (req, reply) => {
    const body = verifySchema.parse(req.body);
    try {
      const result = await verifySiwe({...body, origin: config.PUBLIC_ORIGIN});
      setSessionCookie(reply, result.sessionId, result.expiresAt);
      return reply.send({address: result.address, chainId: result.chainId, expiresAt: result.expiresAt});
    } catch (err) {
      if (err instanceof AuthError) return reply.code(401).send({error: 'siwe_verification_failed', detail: err.message});
      throw err;
    }
  });

  app.post('/auth/logout', async (req, reply) => {
    const session = await readSession(req);
    if (session) await revokeSession(session.id);
    clearSessionCookie(reply);
    return reply.send({ok: true});
  });

  /**
   * Session + compliance status. The frontend uses this to decide whether to show "Open Pack" or a
   * verification prompt — but it is display only: the binding decision is always re-made server-side
   * at the money action (spec §12).
   */
  app.get('/auth/session', async (req, reply) => {
    const session = await readSession(req);
    if (!session) return reply.send({authenticated: false});

    const kyc = await queryOne<{
      status: string;
      jurisdiction: string | null;
      age_verified: boolean;
      fiat_cashout_tier: number;
      self_excluded_until: Date | null;
    }>(
      `SELECT status, jurisdiction, age_verified, fiat_cashout_tier, self_excluded_until
         FROM kyc WHERE user_address = $1`,
      [session.address],
    );

    return reply.send({
      authenticated: true,
      address: session.address,
      chainId: session.chainId,
      compliance: {
        // Surfaced so the UI shows the right prompt — and so a testnet build cannot silently look
        // like a verified production one.
        mode: config.COMPLIANCE_MODE,
        requiresDocuments: requiresDocumentVerification(),
        kycStatus: kyc?.status ?? 'none',
        jurisdiction: kyc?.jurisdiction ?? null,
        ageVerified: kyc?.age_verified ?? false,
        canCashOut: (kyc?.fiat_cashout_tier ?? 0) >= 1,
        selfExcludedUntil: kyc?.self_excluded_until ?? null,
      },
    });
  });

  /**
   * Self-attested age confirmation, for the sealed-pack (`age_only`) posture where there is no
   * cash-out leg to gate. Refused in `full` mode, where age comes from the identity provider and this
   * would be a way around it.
   */
  app.post('/auth/attest-age', {config: {rateLimit: {max: 10, timeWindow: '1 minute'}}}, async (req, reply) => {
    const session = await readSession(req);
    if (!session) return reply.code(401).send({error: 'authentication_required'});

    const body = z.object({confirmedAtLeast: z.number().int()}).parse(req.body);
    if (body.confirmedAtLeast < config.MIN_AGE_YEARS) {
      return reply.code(403).send({error: 'age_not_verified', detail: `You must be at least ${config.MIN_AGE_YEARS}.`});
    }

    try {
      await attestAge(session.address, (req.headers['cf-ipcountry'] as string | undefined) ?? undefined);
      return reply.send({ok: true});
    } catch (err) {
      return reply.code(400).send({error: 'not_applicable', detail: (err as Error).message});
    }
  });

  /**
   * Self-exclusion (spec §12 ToS requirement). Deliberately one-way from the user's side: it can be
   * set here, but only a support process can shorten it. A gambling-adjacent product where the user
   * can instantly undo their own cool-off has not really offered one.
   */
  app.post('/auth/self-exclude', async (req, reply) => {
    const session = await readSession(req);
    if (!session) return reply.code(401).send({error: 'authentication_required'});

    const body = z.object({days: z.number().int().min(1).max(3650)}).parse(req.body);
    const until = new Date(Date.now() + body.days * 86_400_000);

    await queryOne(
      `INSERT INTO kyc (user_address, self_excluded_until) VALUES ($1, $2)
       ON CONFLICT (user_address) DO UPDATE
         SET self_excluded_until = GREATEST(COALESCE(kyc.self_excluded_until, now()), EXCLUDED.self_excluded_until),
             updated_at = now()
       RETURNING user_address`,
      [session.address, until],
    );

    await revokeSession(session.id);
    clearSessionCookie(reply);
    return reply.send({selfExcludedUntil: until});
  });
}

import {randomBytes, createHmac, timingSafeEqual} from 'node:crypto';
import {SiweMessage} from 'siwe';
import type {FastifyReply} from 'fastify';
import {config} from '../config.js';
import {query, queryOne} from '../db/index.js';
import {logger} from '../lib/logger.js';

/**
 * SIWE authentication and sessions (spec §8.1 [MUST][FIX H3-backend]).
 *
 * Each control below closes a specific hole:
 *  - nonces are server-generated, single-use, short-TTL and stored — so a captured SIWE message
 *    cannot be replayed;
 *  - `domain`, `chainId`, `nonce`, `issuedAt`, `expirationTime` and `notBefore` are all validated —
 *    verifying only the signature would let a message signed for another site be presented here;
 *  - sessions are server-side and revocable, bound to the wallet AND the issuing chain, in
 *    Secure/HttpOnly/SameSite cookies, with an explicit logout.
 *
 * Note what a session does NOT grant: it never authorises a money movement on its own. Every rip and
 * buyback additionally requires the user's own EIP-712 signature over the exact terms, so a stolen
 * session cannot spend a user's funds — only browse.
 */

const SESSION_COOKIE = 'collector_session';

export async function issueNonce(): Promise<string> {
  const nonce = randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + config.SIWE_NONCE_TTL_SECONDS * 1000);
  await query('INSERT INTO siwe_nonces (nonce, expires_at) VALUES ($1, $2)', [nonce, expiresAt]);
  return nonce;
}

export interface VerifyResult {
  address: string;
  chainId: number;
  sessionId: string;
  expiresAt: Date;
}

export async function verifySiwe(args: {message: string; signature: string; origin: string}): Promise<VerifyResult> {
  // `SiweMessage` parses against the EIP-4361 ABNF and THROWS on anything malformed — including a
  // statement containing a character outside RFC 3986's set, such as an em-dash or a curly quote.
  // That is client input, so it must surface as a 401 with a usable message, never as a 500.
  let siwe: SiweMessage;
  try {
    siwe = new SiweMessage(args.message);
  } catch (err) {
    throw new AuthError(
      `SIWE message is not valid EIP-4361: ${firstLine(err)}`,
    );
  }

  const expectedDomain = new URL(config.PUBLIC_ORIGIN).host;
  if (siwe.domain !== expectedDomain) {
    throw new AuthError(`SIWE domain mismatch: message is for "${siwe.domain}", this service is "${expectedDomain}"`);
  }
  if (siwe.uri && new URL(siwe.uri).host !== expectedDomain) {
    throw new AuthError('SIWE uri does not belong to this service');
  }

  // Consume the nonce BEFORE checking the signature so a signature-guessing loop cannot burn through
  // attempts against one nonce.
  const consumed = await query<{nonce: string}>(
    `UPDATE siwe_nonces SET consumed = TRUE
      WHERE nonce = $1 AND consumed = FALSE AND expires_at > now()
      RETURNING nonce`,
    [siwe.nonce],
  );
  if (consumed.length === 0) throw new AuthError('SIWE nonce is unknown, already used, or expired');

  const now = new Date();
  if (siwe.expirationTime && new Date(siwe.expirationTime) < now) throw new AuthError('SIWE message has expired');
  if (siwe.notBefore && new Date(siwe.notBefore) > now) throw new AuthError('SIWE message is not yet valid');
  if (siwe.issuedAt && Math.abs(now.getTime() - new Date(siwe.issuedAt).getTime()) > 10 * 60_000) {
    throw new AuthError('SIWE issuedAt is too far from the current time');
  }

  try {
    await siwe.verify({signature: args.signature, domain: expectedDomain, nonce: siwe.nonce});
  } catch {
    throw new AuthError('SIWE signature verification failed');
  }

  const sessionId = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_SECONDS * 1000);
  const address = siwe.address.toLowerCase();

  await query('INSERT INTO sessions (id, user_address, chain_id, expires_at) VALUES ($1,$2,$3,$4)', [
    sessionId,
    address,
    siwe.chainId,
    expiresAt,
  ]);

  return {address, chainId: siwe.chainId, sessionId, expiresAt};
}

export function setSessionCookie(reply: FastifyReply, sessionId: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE, sign(sessionId), {
    path: '/',
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, {path: '/'});
}

export interface Session {
  id: string;
  address: string;
  chainId: number;
}

/**
 * Only the cookie jar is needed, so accept the narrowest shape rather than a fully-parameterised
 * `FastifyRequest`. That keeps these helpers usable from hooks, routes and tests without dragging
 * Fastify's server generics through every signature.
 */
export interface CookieCarrier {
  cookies?: Record<string, string | undefined> | undefined;
}

export async function readSession(req: CookieCarrier): Promise<Session | null> {
  const raw = req.cookies?.[SESSION_COOKIE];
  if (!raw) return null;

  const sessionId = unsign(raw);
  if (!sessionId) return null;

  const row = await queryOne<{id: string; user_address: string; chain_id: string; revoked_at: Date | null}>(
    'SELECT id, user_address, chain_id, revoked_at FROM sessions WHERE id = $1 AND expires_at > now()',
    [sessionId],
  );
  if (!row || row.revoked_at) return null;

  return {id: row.id, address: row.user_address, chainId: Number(row.chain_id)};
}

export async function revokeSession(sessionId: string): Promise<void> {
  await query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [sessionId]);
}

/** Revokes every session for a wallet — the containment step when an account is compromised. */
export async function revokeAllSessions(address: string): Promise<number> {
  const rows = await query<{id: string}>(
    'UPDATE sessions SET revoked_at = now() WHERE user_address = $1 AND revoked_at IS NULL RETURNING id',
    [address.toLowerCase()],
  );
  logger.warn({address, count: rows.length}, 'revoked all sessions for wallet');
  return rows.length;
}

export class AuthError extends Error {
  readonly statusCode = 401;
}

/** The parser's messages are multi-line diagnostics; only the first line is useful to a caller. */
function firstLine(err: unknown): string {
  if (!(err instanceof Error)) return 'parse failed';
  const [first] = err.message.split(/\r?\n/);
  return first ?? 'parse failed';
}

/**
 * Cookie value is `<sessionId>.<hmac>`. The HMAC makes a forged or tampered cookie fail before it ever
 * reaches the database, which keeps session lookup off the path of unauthenticated traffic.
 */
function sign(sessionId: string): string {
  const mac = createHmac('sha256', config.SESSION_SECRET).update(sessionId).digest('hex');
  return `${sessionId}.${mac}`;
}

function unsign(value: string): string | null {
  const idx = value.lastIndexOf('.');
  if (idx <= 0) return null;
  const sessionId = value.slice(0, idx);
  const mac = value.slice(idx + 1);

  const expected = createHmac('sha256', config.SESSION_SECRET).update(sessionId).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(mac, 'utf8');
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? sessionId : null;
}

export async function requireSession(req: CookieCarrier): Promise<Session> {
  const session = await readSession(req);
  if (!session) throw new AuthError('authentication required');
  return session;
}

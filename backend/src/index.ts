import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Redis from 'ioredis';
import {ZodError} from 'zod';
import {config, assertComplianceModeIsSafe} from './config.js';
import {initChains} from './chains.js';
import {logger} from './lib/logger.js';
import {authRoutes} from './routes/auth.js';
import {publicRoutes} from './routes/public.js';
import {moneyRoutes} from './routes/money.js';
import {moonpayRoutes} from './routes/moonpay.js';
import {marketplaceRoutes} from './routes/marketplace.js';
import {AuthError, readSession} from './services/auth.js';
import {ChainRevertError} from './lib/chain-errors.js';
import {pool, isEmbedded} from './db/index.js';
import {bootstrap} from './db/bootstrap.js';
import {initSigners} from './services/signer.js';
import {startWorkers} from './workers/index.js';

async function build() {
  const app = Fastify({
    // `loggerInstance` (not `logger`) is how Fastify v5 accepts an already-constructed pino logger,
    // which is what keeps the redaction rules in lib/logger.ts applied to request logs too.
    loggerInstance: logger,
    trustProxy: true,
  });

  // Every amount in this system is a uint256. Left to itself, JSON.stringify throws on BigInt; cast
  // to Number and it silently loses precision above 2^53. Serialise as decimal strings instead.
  app.setSerializerCompiler(
    () => (data) => JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
  );

  await app.register(helmet, {contentSecurityPolicy: false});
  await app.register(cors, {origin: config.PUBLIC_ORIGIN, credentials: true});
  await app.register(cookie);

  // Rate limits are keyed per IDENTITY where we have one and per IP otherwise (spec §8.1), because an
  // IP-only limit is trivially defeated and an identity-only limit cannot protect the login endpoint.
  // In development the limiter runs in-process so the stack needs no Redis at all. Production
  // refuses to boot without it (config.ts), because an in-memory limiter is per-instance — which
  // means no limit once you run more than one.
  let redis: Redis | undefined;
  if (config.REDIS_URL) {
    redis = new Redis(config.REDIS_URL, {maxRetriesPerRequest: 3, enableOfflineQueue: false});
    redis.on('error', (err) => logger.error({err}, 'redis error'));
  } else {
    logger.warn('REDIS_URL is unset — using an in-memory rate limiter (development only)');
  }

  await app.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: '1 minute',
    ...(redis ? {redis} : {}),
    // FAIL CLOSED. If Redis is unavailable we must get stricter, never open — an outage must not
    // become an unmetered window on the money endpoints (spec §8.4).
    skipOnError: false,
    keyGenerator: (req) => {
      const session = (req as unknown as {sessionAddress?: string}).sessionAddress;
      return session ?? req.ip;
    },
  });

  // Attach the session address early so the rate limiter can key on identity.
  app.addHook('onRequest', async (req) => {
    try {
      const session = await readSession(req);
      if (session) (req as unknown as {sessionAddress?: string}).sessionAddress = session.address;
    } catch {
      // An unreadable cookie is simply an anonymous request.
    }
  });

  // MoonPay's webhook signature covers the raw bytes, so keep them.
  app.addContentTypeParser('application/json', {parseAs: 'string'}, (req, body, done) => {
    (req as unknown as {rawBody?: string}).rawBody = body as string;
    try {
      done(null, body === '' ? {} : JSON.parse(body as string));
    } catch {
      // A syntactically invalid payload is the caller's mistake. Tag it so the error handler reports
      // 400 rather than treating it as a server fault worth paging someone about.
      const error = Object.assign(new Error('Body is not valid JSON'), {statusCode: 400});
      done(error, undefined);
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({error: 'invalid_request', issues: err.issues});
    }
    if (err instanceof AuthError) {
      return reply.code(401).send({error: 'authentication_required', detail: err.message});
    }
    // The chain declining is not a server fault, and the user can usually act on it — say what
    // happened rather than flattening it into a 500 that reads as "the site is broken".
    if (err instanceof ChainRevertError) {
      req.log.warn({err, reason: err.reason}, 'contract declined the request');
      return reply.code(err.statusCode).send({error: err.reason, detail: err.message});
    }

    // Fastify raises its own 4xx for malformed requests — a body that does not match Content-Length,
    // an unparseable JSON payload. Those are the caller's fault, so report them as such instead of
    // flattening every failure into a 500 and sending an operator hunting for a server bug.
    const statusCode = (err as {statusCode?: number}).statusCode;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      req.log.warn({err}, 'rejected malformed request');
      const detail = err instanceof Error ? err.message : 'malformed request';
      return reply.code(statusCode).send({error: 'bad_request', detail});
    }

    req.log.error({err}, 'unhandled error');
    // Never leak an internal message to the client: these can carry RPC URLs and contract internals.
    return reply.code(500).send({error: 'internal_error'});
  });

  await app.register(publicRoutes);
  await app.register(authRoutes);
  await app.register(moneyRoutes);
  await app.register(moonpayRoutes);
  await app.register(marketplaceRoutes);

  return app;
}

async function main() {
  const chains = initChains();
  // NODE_ENV is a label and can be set wrong; a chain id cannot. Refuse to run ungated against a
  // mainnet even if someone mislabels the environment.
  assertComplianceModeIsSafe(chains);

  // Resolve every signing key before accepting traffic. In KMS mode this is a GetPublicKey per role,
  // so a wrong key id, region or IAM grant fails the deploy instead of a user's first purchase.
  const signers = await initSigners();
  logger.info({signers}, 'signing keys resolved');

  logger.info(
    {chains: chains.map((c) => ({key: c.key, chainId: c.chainId, gacha: c.gachaEnabled}))},
    'chain registry loaded',
  );

  const app = await build();
  await app.listen({port: config.PORT, host: '0.0.0.0'});

  // Deliberately AFTER listen and BEFORE the workers.
  //
  // After listen, because seeding a fresh database is slow enough to fail a platform health check,
  // and a backend that is merely unseeded still serves every endpoint that does not need a pack —
  // it repairs itself a moment later rather than never starting.
  //
  // Before the workers, because this is what moves the indexer cursor to the deployment block. Start
  // the indexer first and it begins walking a multi-million-block chain from genesis, which it will
  // not finish. Idempotent and near-free once seeded, so it runs on every boot.
  await bootstrap();

  // The embedded development database is single-writer, so the workers physically cannot run in
  // their own process against it — run them here instead. Against a real Postgres they are a separate
  // deployment, and an explicit opt-in still exists for anyone who wants a single-process setup.
  if (isEmbedded || process.env.RUN_WORKERS_IN_PROCESS === 'true') {
    logger.info('running workers in-process (embedded database)');
    void startWorkers();
  }

  const shutdown = async (signal: string) => {
    logger.info({signal}, 'shutting down');
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({err}, 'failed to start');
  process.exit(1);
});

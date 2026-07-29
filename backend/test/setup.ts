/**
 * Minimal environment for unit tests.
 *
 * `config.ts` validates at import time and exits on anything missing — which is the behaviour we want
 * in production, so tests supply a valid-but-inert configuration rather than weakening the validator.
 * Nothing here reaches a real service: the private keys are the well-known Anvil test keys and the
 * connection strings are never dialled by the pure-function tests.
 */
process.env.NODE_ENV = 'test';
process.env.PUBLIC_ORIGIN = 'http://localhost:3000';
process.env.DATABASE_URL = 'postgres://collector:collector@localhost:5432/collector_test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.SESSION_SECRET = 'test-session-secret-at-least-32-characters-long';
process.env.SIGNER_MODE = 'local';
process.env.ORACLE_PRIVATE_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
process.env.RELAYER_PRIVATE_KEY =
  '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba';
process.env.BUYBACK_PRIVATE_KEY =
  '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e';
process.env.POOL_AUTHOR_PRIVATE_KEY =
  '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356';
process.env.ENABLED_CHAINS = 'base_sepolia';
process.env.BASE_SEPOLIA_RPC_URL = 'https://sepolia.base.org';
// Pin the compliance mode explicitly. A developer's local `.env` may well have COMPLIANCE_MODE=off
// for devnet work, and the guard tests need a known starting point.
process.env.COMPLIANCE_MODE = 'full';
process.env.GACHA_BLOCKED_JURISDICTIONS = 'BE,NL';
process.env.LOG_LEVEL = 'fatal';

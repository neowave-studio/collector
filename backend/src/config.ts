import {existsSync} from 'node:fs';
import {z} from 'zod';

// Load `.env` if one is present. Node 20.6+ ships the parser, so no dependency is needed; in a
// container the platform injects the environment and no file exists, hence the guard.
//
// A real environment variable ALWAYS wins over the file. `process.loadEnvFile` overwrites, which is
// the wrong precedence — it would let a stale local `.env` silently override what a deployment or a
// test harness explicitly set. So snapshot first and restore afterwards.
if (existsSync('.env')) {
  const preexisting = {...process.env};
  try {
    process.loadEnvFile('.env');
    for (const [key, value] of Object.entries(preexisting)) {
      if (value !== undefined) process.env[key] = value;
    }
  } catch {
    // Older Node, or an unreadable file. Fall through to whatever is already in the environment.
  }
}

/**
 * Environment configuration, validated once at boot.
 *
 * Two rules encoded here rather than left to a runbook:
 *  1. production refuses to start with in-process private keys (spec §8.6 — keys live in KMS/HSM);
 *  2. production refuses to start without a compliance configuration, because §12 makes the
 *     jurisdiction gate a launch blocker, not a feature flag.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  PUBLIC_ORIGIN: z.string().url(),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default(''),

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  SIWE_NONCE_TTL_SECONDS: z.coerce.number().int().positive().default(300),

  SIGNER_MODE: z.enum(['local', 'kms']).default('local'),
  ORACLE_PRIVATE_KEY: z.string().optional(),
  RELAYER_PRIVATE_KEY: z.string().optional(),
  BUYBACK_PRIVATE_KEY: z.string().optional(),
  POOL_AUTHOR_PRIVATE_KEY: z.string().optional(),
  KMS_ORACLE_KEY_ID: z.string().optional(),
  KMS_RELAYER_KEY_ID: z.string().optional(),
  KMS_BUYBACK_KEY_ID: z.string().optional(),
  KMS_POOL_AUTHOR_KEY_ID: z.string().optional(),
  AWS_REGION: z.string().default('us-east-1'),

  ENABLED_CHAINS: z.string().transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)),

  MOONPAY_API_KEY: z.string().optional(),
  MOONPAY_SECRET_KEY: z.string().optional(),
  MOONPAY_WEBHOOK_SECRET: z.string().optional(),
  MOONPAY_WIDGET_BASE: z.string().url().default('https://buy-sandbox.moonpay.com'),
  FIAT_CHARGEBACK_HOLDBACK_DAYS: z.coerce.number().int().min(0).max(150).default(120),

  /**
   * How hard the money-action gate is (spec §12).
   *
   *   full     — document KYC, verified jurisdiction, age, and a cash-out tier for sell-back.
   *              Required whenever the sell-back path is live on a real-money chain.
   *   age_only — self-attested age plus IP-derived jurisdiction. The posture for a no-sell-back
   *              "sealed pack" product, where there is no cash-out leg to gate.
   *   off      — no gate at all. TESTNET DEVELOPMENT ONLY; the guards below make it impossible to
   *              run against production or a mainnet chain.
   */
  COMPLIANCE_MODE: z.enum(['full', 'age_only', 'off']).default('full'),

  GACHA_BLOCKED_JURISDICTIONS: z
    .string()
    .default('')
    .transform((s) => new Set(s.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean))),
  MIN_AGE_YEARS: z.coerce.number().int().min(18).default(18),
  KYC_PROVIDER_URL: z.string().optional(),
  KYC_PROVIDER_API_KEY: z.string().optional(),

  IPFS_PIN_ENDPOINTS: z
    .string()
    .default('')
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)),
  ARWEAVE_GATEWAY: z.string().default('https://arweave.net'),
  PROOF_TOOL_URL: z.string().default(''),

  RECONCILER_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  INDEXER_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
  RECONCILER_AUTOPAUSE: z
    .string()
    .default('true')
    .transform((s) => s === 'true'),
  ALERT_WEBHOOK_URL: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;

if (config.NODE_ENV === 'production') {
  if (config.SIGNER_MODE !== 'kms') {
    throw new Error(
      'SIGNER_MODE must be "kms" in production. Spec §8.6: signing keys never leave the HSM, and the ' +
        'process must only ever see signatures.',
    );
  }
  const missingKms = (
    ['KMS_ORACLE_KEY_ID', 'KMS_RELAYER_KEY_ID', 'KMS_BUYBACK_KEY_ID', 'KMS_POOL_AUTHOR_KEY_ID'] as const
  ).filter((k) => !config[k]);
  if (missingKms.length) {
    throw new Error(`Missing KMS key ids in production: ${missingKms.join(', ')}`);
  }
  // The single most dangerous configuration in this system: a production deployment with the
  // compliance gate disabled. Refuse to start rather than serve one paid draw ungated.
  if (config.COMPLIANCE_MODE === 'off') {
    throw new Error(
      'COMPLIANCE_MODE=off is a testnet-only development setting and cannot run in production. ' +
        'Set it to "full" (document KYC + cash-out tier) or "age_only" (no sell-back product shape).',
    );
  }
  if (config.GACHA_BLOCKED_JURISDICTIONS.size === 0) {
    throw new Error(
      'GACHA_BLOCKED_JURISDICTIONS is empty. Spec §12 requires a counsel-approved jurisdiction list ' +
        'before paid draws are offered; an empty list is treated as unconfigured, not as "allow all".',
    );
  }
  if (config.COMPLIANCE_MODE === 'full' && !config.KYC_PROVIDER_URL) {
    throw new Error('KYC_PROVIDER_URL is required for COMPLIANCE_MODE=full: the gate has no source of truth without it.');
  }
  if (!config.MOONPAY_WEBHOOK_SECRET) {
    throw new Error('MOONPAY_WEBHOOK_SECRET is required in production to verify webhook signatures.');
  }
  if (config.DATABASE_URL.startsWith('pglite://')) {
    throw new Error(
      'The embedded development database cannot be used in production. It is a single in-process ' +
        'connection, so the advisory locks that keep the indexer and reconciler singleton become no-ops.',
    );
  }
  if (!config.REDIS_URL) {
    throw new Error(
      'REDIS_URL is required in production. Rate limiting fails closed, and an in-memory limiter is ' +
        'per-instance — which means no limit at all once you run more than one.',
    );
  }
}

export const isProduction = config.NODE_ENV === 'production';

/**
 * Second half of the `COMPLIANCE_MODE=off` guard.
 *
 * `NODE_ENV` is a deployment label and can be set wrong; the chain id cannot. This is called after the
 * chain registry loads and refuses to continue if the gate is disabled while ANY enabled chain is a
 * mainnet — which is the configuration that would take real money from unverified users.
 */
export function assertComplianceModeIsSafe(chains: {key: string; testnet?: boolean | undefined}[]): void {
  if (config.COMPLIANCE_MODE !== 'off') return;

  const mainnets = chains.filter((c) => !c.testnet).map((c) => c.key);
  if (mainnets.length > 0) {
    throw new Error(
      `COMPLIANCE_MODE=off but these enabled chains are mainnets: ${mainnets.join(', ')}. ` +
        `The gate may only be disabled when every enabled chain is a testnet.`,
    );
  }
}

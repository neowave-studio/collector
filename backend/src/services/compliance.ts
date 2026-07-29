import {query, queryOne} from '../db/index.js';
import {config} from '../config.js';
import {logger} from '../lib/logger.js';

/**
 * Jurisdiction, age and risk gating for the money action (spec §12).
 *
 * The gate has three postures, because the requirement is driven by the PRODUCT SHAPE rather than by
 * the payment rail. What creates the obligation is "pay money → random outcome → operator pays cash
 * back out"; remove the last leg and the posture changes.
 *
 *   full      Sell-back is live. Document KYC, verified jurisdiction, verified age, and a separate
 *             cash-out tier before anyone can sell a card back for money.
 *   age_only  No sell-back — users keep, redeem or trade peer-to-peer. Self-attested age plus
 *             IP-derived jurisdiction, which is the ordinary sealed-pack retail posture.
 *   off       No gate. Testnet development only; `config.ts` and `assertComplianceModeIsSafe`
 *             make it impossible to run against production or a mainnet chain.
 *
 * Rules that hold in EVERY mode, because they are properties of the design rather than of the mode:
 *
 *  1. **Gate BEFORE payment.** The check runs in `POST /rip` before any signature is relayed. Once a
 *     paid draw exists on-chain it must remain settleable forever — stranding a user's funds to
 *     enforce a geofence would be worse than the geofence failing. The gate is never on settlement,
 *     and never on the escape hatches.
 *  2. **Fail closed.** An unreachable identity provider refuses the rip. An "allow on error" branch
 *     in this file would be a compliance incident waiting to happen.
 *  3. **Log the decision.** Every rip records which jurisdiction was evaluated and what was decided,
 *     so the control is auditable after the fact.
 */

export type ComplianceMode = typeof config.COMPLIANCE_MODE;

export interface ComplianceContext {
  user: string;
  ip?: string | undefined;
  ipCountry?: string | undefined;
}

export type ComplianceDecision =
  | {allowed: true; jurisdiction: string; ageVerified: boolean; mode: ComplianceMode}
  | {allowed: false; reason: ComplianceRefusalReason; detail: string; mode: ComplianceMode};

export type ComplianceRefusalReason =
  | 'kyc_required'
  | 'kyc_pending'
  | 'kyc_rejected'
  | 'jurisdiction_blocked'
  | 'age_not_verified'
  | 'age_attestation_required'
  | 'self_excluded'
  | 'provider_unavailable'
  | 'ip_jurisdiction_mismatch';

interface KycRow {
  user_address: string;
  status: 'none' | 'pending' | 'approved' | 'rejected';
  jurisdiction: string | null;
  age_verified: boolean;
  fiat_cashout_tier: number;
  self_excluded_until: Date | null;
}

const mode = config.COMPLIANCE_MODE;

/** True when identity documents are being collected. Surfaced to the UI so it can adapt. */
export function requiresDocumentVerification(): boolean {
  return mode === 'full';
}

// =================================================================================================
// Rip gate
// =================================================================================================

/** The gate for a paid draw. Must be called on every rip, not just at login. */
export async function checkRipAllowed(ctx: ComplianceContext): Promise<ComplianceDecision> {
  const kyc = await queryOne<KycRow>('SELECT * FROM kyc WHERE user_address = $1', [ctx.user.toLowerCase()]);

  // Self-exclusion is honoured in every mode, including `off`. A user who asked us to stop letting
  // them play is not a compliance formality — turning that off with a config flag would be indefensible.
  if (kyc?.self_excluded_until && kyc.self_excluded_until > new Date()) {
    return {
      allowed: false,
      reason: 'self_excluded',
      detail: `Self-exclusion is active until ${kyc.self_excluded_until.toISOString()}.`,
      mode,
    };
  }

  if (mode === 'off') {
    return {allowed: true, jurisdiction: ctx.ipCountry?.toUpperCase() ?? 'UNVERIFIED', ageVerified: false, mode};
  }

  if (mode === 'age_only') return checkAgeOnly(ctx, kyc);
  return checkFull(ctx, kyc);
}

/**
 * Sealed-pack posture: the user attests they are old enough, and we refuse jurisdictions on the
 * blocklist using the IP signal. No documents, because there is no cash-out leg to gate.
 */
function checkAgeOnly(ctx: ComplianceContext, kyc: KycRow | undefined): ComplianceDecision {
  if (!kyc?.age_verified) {
    return {
      allowed: false,
      reason: 'age_attestation_required',
      detail: `You must confirm you are at least ${config.MIN_AGE_YEARS} before opening a pack.`,
      mode,
    };
  }

  const jurisdiction = (ctx.ipCountry ?? kyc.jurisdiction ?? '').toUpperCase();
  if (jurisdiction && isBlocked(jurisdiction)) {
    return {allowed: false, reason: 'jurisdiction_blocked', detail: `Packs are not offered in ${jurisdiction}.`, mode};
  }

  return {allowed: true, jurisdiction: jurisdiction || 'UNKNOWN', ageVerified: true, mode};
}

/**
 * Full posture. The binding jurisdiction comes from verified KYC, never from IP — a VPN defeats IP,
 * so treating it as authoritative would be security theatre (spec FIX H4-backend).
 */
function checkFull(ctx: ComplianceContext, kyc: KycRow | undefined): ComplianceDecision {
  if (!kyc || kyc.status === 'none') {
    return {allowed: false, reason: 'kyc_required', detail: 'Identity verification is required before opening a pack.', mode};
  }
  if (kyc.status === 'pending') {
    return {allowed: false, reason: 'kyc_pending', detail: 'Identity verification is still in progress.', mode};
  }
  if (kyc.status === 'rejected') {
    return {allowed: false, reason: 'kyc_rejected', detail: 'Identity verification was not successful.', mode};
  }
  if (!kyc.age_verified) {
    return {
      allowed: false,
      reason: 'age_not_verified',
      detail: `Verified age of at least ${config.MIN_AGE_YEARS} is required.`,
      mode,
    };
  }

  const jurisdiction = kyc.jurisdiction?.toUpperCase();
  if (!jurisdiction) {
    return {allowed: false, reason: 'kyc_required', detail: 'No verified jurisdiction on file.', mode};
  }
  if (isBlocked(jurisdiction)) {
    return {allowed: false, reason: 'jurisdiction_blocked', detail: `Packs are not offered in ${jurisdiction}.`, mode};
  }

  // IP is supplementary. A mismatch alone does not prove evasion (travel, privacy VPN), so it refuses
  // only when the request originates from a BLOCKED jurisdiction — the actual shape of an evasion.
  if (ctx.ipCountry && isBlocked(ctx.ipCountry.toUpperCase())) {
    logger.warn(
      {user: ctx.user, verified: jurisdiction, ipCountry: ctx.ipCountry},
      'rip refused: request originated from a blocked jurisdiction',
    );
    return {
      allowed: false,
      reason: 'ip_jurisdiction_mismatch',
      detail: 'This request appears to originate from a jurisdiction where packs are not offered.',
      mode,
    };
  }

  return {allowed: true, jurisdiction, ageVerified: true, mode};
}

function isBlocked(code: string): boolean {
  if (config.GACHA_BLOCKED_JURISDICTIONS.has(code)) return true;
  // A sub-national entry such as "US-WA" blocks on its exact form; a bare country code blocks the
  // whole country.
  const country = code.split('-')[0];
  return country !== undefined && config.GACHA_BLOCKED_JURISDICTIONS.has(country);
}

// =================================================================================================
// Cash-out gate
// =================================================================================================

/**
 * Sell-back gate (spec §12 + §9).
 *
 * Turning a random draw into money is the characteristic that most strongly attracts gambling and
 * money-transmission regimes, so this carries a stricter tier than simply opening a pack, plus the
 * fiat chargeback holdback.
 *
 * In `age_only` mode the sell-back path is not part of the product at all, so this refuses outright
 * rather than silently applying a weaker check — the mode and the product must not disagree.
 */
export async function checkBuybackAllowed(user: string): Promise<ComplianceDecision> {
  if (mode === 'age_only') {
    return {
      allowed: false,
      reason: 'provider_unavailable',
      detail:
        'Selling a card back to the platform is not offered. You can keep the card, have the physical ' +
        'card shipped to you, or sell it to another collector on the marketplace.',
      mode,
    };
  }

  const base = await checkRipAllowed({user});
  if (!base.allowed) return base;
  if (mode === 'off') return base;

  const kyc = await queryOne<KycRow>('SELECT * FROM kyc WHERE user_address = $1', [user.toLowerCase()]);
  if (!kyc || kyc.fiat_cashout_tier < 1) {
    return {
      allowed: false,
      reason: 'kyc_required',
      detail: 'Additional verification is required before selling a card back.',
      mode,
    };
  }

  const holdback = await queryOne<{holdback_until: Date}>(
    `SELECT MAX(holdback_until) AS holdback_until FROM moonpay_orders
      WHERE user_address = $1 AND chargeback_state = 'none' AND holdback_until > now()`,
    [user.toLowerCase()],
  );
  if (holdback?.holdback_until) {
    return {
      allowed: false,
      reason: 'provider_unavailable',
      detail:
        `Cards funded by card payment can be sold back after ${holdback.holdback_until.toISOString()}, ` +
        `once the payment can no longer be reversed. You can keep or redeem the card at any time.`,
      mode,
    };
  }

  const disputed = await queryOne<{count: string}>(
    `SELECT COUNT(*)::text AS count FROM moonpay_orders
      WHERE user_address = $1 AND chargeback_state IN ('disputed', 'charged_back')`,
    [user.toLowerCase()],
  );
  if (disputed && Number(disputed.count) > 0) {
    return {allowed: false, reason: 'provider_unavailable', detail: 'This account is under payment review.', mode};
  }

  return base;
}

// =================================================================================================
// Age attestation (age_only mode)
// =================================================================================================

/**
 * Records a self-attested age confirmation.
 *
 * Only meaningful in `age_only` mode; in `full` mode age comes from the identity provider and this
 * would be a way to bypass it, so it refuses.
 */
export async function attestAge(user: string, jurisdiction: string | undefined): Promise<void> {
  if (mode === 'full') {
    throw new Error('Age is established by the identity provider in this configuration, not by self-attestation.');
  }

  await query(
    `INSERT INTO kyc (user_address, status, jurisdiction, age_verified)
     VALUES ($1, 'approved', $2, TRUE)
     ON CONFLICT (user_address) DO UPDATE
       SET age_verified = TRUE,
           jurisdiction = COALESCE(EXCLUDED.jurisdiction, kyc.jurisdiction),
           updated_at = now()`,
    [user.toLowerCase(), jurisdiction?.toUpperCase() ?? null],
  );
}

export async function recordDecision(args: {
  user: string;
  action: string;
  decision: ComplianceDecision;
  ip?: string | undefined;
}): Promise<void> {
  await query(
    `INSERT INTO audit_log (actor, action, target, after_val, ip)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      args.user.toLowerCase(),
      `compliance.${args.action}`,
      args.user.toLowerCase(),
      JSON.stringify(args.decision),
      args.ip ?? null,
    ],
  );
}

logger.info(
  {mode, blockedJurisdictions: config.GACHA_BLOCKED_JURISDICTIONS.size},
  mode === 'off'
    ? 'COMPLIANCE GATE DISABLED — testnet development mode'
    : `compliance gate active (${mode})`,
);

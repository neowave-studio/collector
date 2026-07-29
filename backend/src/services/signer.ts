import {privateKeyToAccount} from 'viem/accounts';
import type {Account, Hex, LocalAccount, TypedDataDomain} from 'viem';
import {config} from '../config.js';
import {logger} from '../lib/logger.js';
import {createKmsAccount} from './kms.js';

/**
 * Signing key abstraction (spec §6.3 / §8.6).
 *
 * Production runs `SIGNER_MODE=kms`: the raw key never exists in this process, `AWS_KMS` performs the
 * ECDSA operation and we only ever receive a signature. `config.ts` refuses to boot production with
 * local keys, so the development path below cannot leak into a real deployment by accident.
 *
 * Least privilege is enforced by the SEPARATION of these four roles, not by this file:
 *  - `oracle` signs BuybackAuth and nothing else — it has no on-chain role and cannot submit anything;
 *  - `relayer` may call `rip`/`settle` but has NO authority over `withdrawSurplus`;
 *  - `buyback` may submit `settleBuyback` but cannot produce the oracle signature it needs;
 *  - `poolAuthor` may commit pools but cannot touch the reserve.
 * Draining the reserve therefore requires at least three of these keys plus a mispriced pool, and is
 * still bounded by the on-chain per-epoch cap (spec §8.8).
 */
export type SignerRole = 'oracle' | 'relayer' | 'buyback' | 'poolAuthor';

export interface Signer {
  readonly role: SignerRole;
  readonly address: Hex;
  /** viem `Account` for use with `walletClient`. */
  readonly account: Account;
  signTypedData(args: {
    domain: TypedDataDomain;
    types: Record<string, readonly {name: string; type: string}[]>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<Hex>;
}

const LOCAL_KEY_ENV: Record<SignerRole, keyof typeof config> = {
  oracle: 'ORACLE_PRIVATE_KEY',
  relayer: 'RELAYER_PRIVATE_KEY',
  buyback: 'BUYBACK_PRIVATE_KEY',
  poolAuthor: 'POOL_AUTHOR_PRIVATE_KEY',
};

const KMS_KEY_ENV: Record<SignerRole, keyof typeof config> = {
  oracle: 'KMS_ORACLE_KEY_ID',
  relayer: 'KMS_RELAYER_KEY_ID',
  buyback: 'KMS_BUYBACK_KEY_ID',
  poolAuthor: 'KMS_POOL_AUTHOR_KEY_ID',
};

const cache = new Map<SignerRole, Signer>();

/**
 * Synchronous accessor used on the hot paths.
 *
 * KMS keys must be resolved once at boot (fetching the public key is a network call), so in KMS mode
 * this throws unless {initSigners} has run. That is deliberate: a lazily-initialised signer would turn
 * a misconfigured key into a 500 on a user's first purchase instead of a failure to start.
 */
export function getSigner(role: SignerRole): Signer {
  const cached = cache.get(role);
  if (cached) return cached;

  if (config.SIGNER_MODE === 'kms') {
    throw new Error(`KMS signer "${role}" was not initialised. Call initSigners() during startup.`);
  }

  const signer = createLocalSigner(role);
  cache.set(role, signer);
  logger.info({role, address: signer.address, mode: 'local'}, 'signer initialised');
  return signer;
}

/**
 * Resolves every signing key at startup. In KMS mode this performs a `GetPublicKey` per role, so a
 * wrong key id, a wrong region or a missing IAM grant surfaces as a boot failure.
 */
export async function initSigners(): Promise<Record<SignerRole, Hex>> {
  const roles: SignerRole[] = ['oracle', 'relayer', 'buyback', 'poolAuthor'];
  const addresses = {} as Record<SignerRole, Hex>;

  for (const role of roles) {
    const signer =
      config.SIGNER_MODE === 'kms' ? await createKmsSigner(role) : createLocalSigner(role);
    cache.set(role, signer);
    addresses[role] = signer.address;
    logger.info({role, address: signer.address, mode: config.SIGNER_MODE}, 'signer initialised');
  }

  // Distinct keys per role is what makes the collusion table in docs/ROLE-COLLUSION.md true. Sharing
  // one key across roles would collapse the three-key reserve-drain path to one.
  const unique = new Set(Object.values(addresses).map((a) => a.toLowerCase()));
  if (unique.size !== roles.length) {
    throw new Error(
      'Two or more signer roles resolve to the same address. Least privilege depends on these being ' +
        'separate keys — see docs/ROLE-COLLUSION.md.',
    );
  }

  return addresses;
}

function createLocalSigner(role: SignerRole): Signer {
  const key = config[LOCAL_KEY_ENV[role]] as string | undefined;
  if (!key) throw new Error(`Missing ${String(LOCAL_KEY_ENV[role])} for the "${role}" signer`);

  const account = privateKeyToAccount(key as Hex);
  return {
    role,
    address: account.address,
    account,
    signTypedData: (args) => account.signTypedData(args as never),
  };
}

/**
 * KMS-backed signer. The private key never leaves the HSM; see {@link ./kms.ts} for the DER decoding,
 * low-`s` normalisation and recovery-id search that Ethereum requires and KMS does not provide.
 *
 * There is deliberately NO fallback to a local key here. A signer that quietly degrades from HSM to
 * in-process material is exactly the failure mode §8.6 exists to prevent.
 */
async function createKmsSigner(role: SignerRole): Promise<Signer> {
  const keyId = config[KMS_KEY_ENV[role]] as string | undefined;
  if (!keyId) throw new Error(`Missing ${String(KMS_KEY_ENV[role])} for the "${role}" signer`);

  const account: LocalAccount = await createKmsAccount(keyId, config.AWS_REGION);
  return {
    role,
    address: account.address,
    account,
    signTypedData: (args) => account.signTypedData(args as never),
  };
}

/** Clears cached signers so a rotation takes effect without a restart (spec §6.3). */
export function resetSigners(): void {
  cache.clear();
}

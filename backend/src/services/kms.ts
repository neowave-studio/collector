import {GetPublicKeyCommand, KMSClient, SignCommand} from '@aws-sdk/client-kms';
import {
  hashMessage,
  hashTypedData,
  keccak256,
  recoverAddress,
  serializeTransaction,
  type Address,
  type Hex,
  type LocalAccount,
} from 'viem';
import {toAccount} from 'viem/accounts';
import {logger} from '../lib/logger.js';

/**
 * AWS KMS secp256k1 signer (spec §6.3 / §8.6).
 *
 * The private key is generated inside KMS and never exists outside it — this process only ever sees
 * a signature. That is the whole point: a compromised backend host leaks the *ability to ask KMS to
 * sign*, which CloudTrail records and an IAM policy change revokes, rather than leaking a key that is
 * then valid forever on every chain.
 *
 * Three details that trip up most hand-rolled KMS signers, all handled below:
 *
 *  1. **KMS returns DER, Ethereum wants (r, s, v).** The signature is an ASN.1 SEQUENCE of two
 *     INTEGERs, each of which may carry a leading 0x00 sign byte or be shorter than 32 bytes.
 *  2. **KMS may return a high `s`.** ECDSA signatures are malleable: `(r, s)` and `(r, n - s)` are
 *     both valid. Ethereum rejects the upper half, so `s` must be normalised — and when it is
 *     flipped, the recovery bit flips with it.
 *  3. **There is no recovery id.** KMS does not return `v`, so it is found by trying both parities
 *     and keeping the one that recovers this key's own address. If neither does, something is wrong
 *     with the key or the digest and we must fail loudly rather than emit a signature that will be
 *     attributed to the wrong signer.
 *
 * Required IAM on each key: `kms:Sign` and `kms:GetPublicKey`, granted to the specific task role and
 * nothing else. Alarm on `kms:Sign` from any other principal (spec §8.6).
 *
 * Key creation:
 *   aws kms create-key --key-spec ECC_SECG_P256K1 --key-usage SIGN_VERIFY \
 *     --description "collector-oracle"
 */

const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const SECP256K1_HALF_N = SECP256K1_N / 2n;

let client: KMSClient | undefined;

function kms(region: string): KMSClient {
  if (!client) client = new KMSClient({region});
  return client;
}

// ------------------------------------------------------------------------------------------------
// DER decoding
// ------------------------------------------------------------------------------------------------

function readDerInteger(der: Uint8Array, offset: number): {value: bigint; next: number} {
  if (der[offset] !== 0x02) throw new Error(`expected DER INTEGER at offset ${offset}, got 0x${der[offset]?.toString(16)}`);
  const length = der[offset + 1];
  if (length === undefined) throw new Error('truncated DER INTEGER');

  const bytes = der.slice(offset + 2, offset + 2 + length);
  let value = 0n;
  for (const b of bytes) value = (value << 8n) | BigInt(b);
  return {value, next: offset + 2 + length};
}

/** Extracts `(r, s)` from a DER-encoded ECDSA signature. */
export function decodeDerSignature(der: Uint8Array): {r: bigint; s: bigint} {
  if (der[0] !== 0x30) throw new Error('expected a DER SEQUENCE');
  // Skip SEQUENCE tag + length. Long-form lengths do not occur for a 2x32-byte signature.
  const {value: r, next} = readDerInteger(der, 2);
  const {value: s} = readDerInteger(der, next);
  return {r, s};
}

/** Extracts the 20-byte Ethereum address from a DER SubjectPublicKeyInfo. */
export function addressFromDerPublicKey(der: Uint8Array): Address {
  // The uncompressed point is the trailing 65 bytes and always starts with 0x04.
  const point = der.slice(der.length - 65);
  if (point[0] !== 0x04) {
    throw new Error('KMS public key is not an uncompressed secp256k1 point — is the key spec ECC_SECG_P256K1?');
  }
  // The address is the last 20 bytes of keccak256 over the 64-byte (x || y) coordinate pair.
  const hash = keccak256(point.slice(1));
  return `0x${hash.slice(-40)}` as Address;
}

function toHex32(value: bigint): Hex {
  return `0x${value.toString(16).padStart(64, '0')}`;
}

// ------------------------------------------------------------------------------------------------
// Signing
// ------------------------------------------------------------------------------------------------

async function signDigest(args: {keyId: string; region: string; address: Address; digest: Hex}): Promise<Hex> {
  const response = await kms(args.region).send(
    new SignCommand({
      KeyId: args.keyId,
      // The digest is already keccak-256 of the payload, so KMS must not hash it again.
      MessageType: 'DIGEST',
      Message: Buffer.from(args.digest.slice(2), 'hex'),
      SigningAlgorithm: 'ECDSA_SHA_256',
    }),
  );

  if (!response.Signature) throw new Error('KMS returned no signature');

  const {r, s: rawS} = decodeDerSignature(response.Signature);

  // Normalise to the lower half-order. Flipping `s` mirrors the point across the x-axis, which also
  // flips the recovery parity — but since we search for the parity below, we only need `s` correct.
  const s = rawS > SECP256K1_HALF_N ? SECP256K1_N - rawS : rawS;

  for (const yParity of [0, 1] as const) {
    const signature: Hex = `0x${r.toString(16).padStart(64, '0')}${s
      .toString(16)
      .padStart(64, '0')}${(27 + yParity).toString(16).padStart(2, '0')}`;

    const recovered = await recoverAddress({hash: args.digest, signature});
    if (recovered.toLowerCase() === args.address.toLowerCase()) return signature;
  }

  throw new Error(
    `Neither recovery id reproduces ${args.address} for KMS key ${args.keyId}. The key, the region, or ` +
      `the digest is wrong — refusing to emit a signature that would be attributed to another signer.`,
  );
}

// ------------------------------------------------------------------------------------------------
// Account
// ------------------------------------------------------------------------------------------------

/**
 * Builds a viem account backed by a KMS key. Usable anywhere a `privateKeyToAccount` result is —
 * including `walletClient.sendTransaction`, which the relayer needs.
 */
export async function createKmsAccount(keyId: string, region: string): Promise<LocalAccount> {
  const publicKey = await kms(region).send(new GetPublicKeyCommand({KeyId: keyId}));
  if (!publicKey.PublicKey) throw new Error(`KMS key ${keyId} returned no public key`);

  const address = addressFromDerPublicKey(publicKey.PublicKey);
  logger.info({keyId, address}, 'resolved KMS signing key');

  const account = toAccount({
    address,

    async signMessage({message}) {
      return signDigest({keyId, region, address, digest: hashMessage(message)});
    },

    async signTypedData(typedData) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return signDigest({keyId, region, address, digest: hashTypedData(typedData as any)});
    },

    async signTransaction(transaction, options) {
      const serializer = options?.serializer ?? serializeTransaction;
      // Custom serializers may be async, so resolve before hashing.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const unsigned = await serializer(transaction as any);
      const signature = await signDigest({keyId, region, address, digest: keccak256(unsigned)});

      const r = `0x${signature.slice(2, 66)}` as Hex;
      const s = `0x${signature.slice(66, 130)}` as Hex;
      const v = BigInt(`0x${signature.slice(130, 132)}`);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await serializer(transaction as any, {r, s, v, yParity: Number(v - 27n)});
    },
  });

  return account as LocalAccount;
}

/** Round-trips a signature through KMS so preflight fails on a misconfigured key, not in production. */
export async function verifyKmsKeyUsable(keyId: string, region: string): Promise<Address> {
  const account = await createKmsAccount(keyId, region);
  const probe = keccak256(new TextEncoder().encode('collector.kms.preflight'));
  const signature = await signDigest({keyId, region, address: account.address, digest: probe});
  const recovered = await recoverAddress({hash: probe, signature});
  if (recovered.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(`KMS key ${keyId} produced a signature that does not recover to its own address`);
  }
  return account.address;
}

export {toHex32};

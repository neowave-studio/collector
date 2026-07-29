import {describe, expect, it} from 'vitest';
import {privateKeyToAccount} from 'viem/accounts';
import {keccak256, recoverAddress, toBytes} from 'viem';
import {addressFromDerPublicKey, decodeDerSignature} from '../src/services/kms.js';

/**
 * The KMS signer cannot be integration-tested without AWS, but the three things that actually go
 * wrong in KMS signers are pure functions of bytes — so they are tested here.
 *
 * A bug in any of them produces a *valid-looking* signature attributed to the wrong address, which is
 * exactly the failure that would silently break the oracle role in production.
 */
describe('KMS DER decoding', () => {
  it('decodes a signature whose r and s are full 32 bytes', () => {
    const r = 'a'.repeat(64);
    const s = 'b'.repeat(64);
    const der = toBytes(`0x3044 0220 ${r} 0220 ${s}`.replace(/ /g, ''));
    const decoded = decodeDerSignature(der);
    expect(decoded.r.toString(16)).toBe(r);
    expect(decoded.s.toString(16)).toBe(s);
  });

  it('handles the leading 0x00 sign byte DER adds to high values', () => {
    // DER INTEGERs are signed, so a value whose top bit is set gets a 0x00 prefix and length 33.
    const r = `00${'f'.repeat(64)}`;
    const s = 'b'.repeat(64);
    const der = toBytes(`0x3045 0221 ${r} 0220 ${s}`.replace(/ /g, ''));
    const decoded = decodeDerSignature(der);
    expect(decoded.r).toBe(BigInt(`0x${'f'.repeat(64)}`));
    expect(decoded.s).toBe(BigInt(`0x${s}`));
  });

  it('handles short values that DER encodes without leading zeros', () => {
    const der = toBytes('0x3006020101020102');
    const decoded = decodeDerSignature(der);
    expect(decoded.r).toBe(1n);
    expect(decoded.s).toBe(2n);
  });

  it('rejects anything that is not a DER SEQUENCE', () => {
    expect(() => decodeDerSignature(toBytes('0x310401020102'))).toThrow(/DER SEQUENCE/);
  });

  it('derives the same address from a public key that viem derives from its private key', () => {
    const account = privateKeyToAccount(
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    );

    // Build the DER SubjectPublicKeyInfo wrapper KMS returns around the uncompressed point. Only the
    // trailing 65 bytes matter to the extractor, which is what this asserts.
    const uncompressed = account.publicKey; // 0x04 || x || y
    const spkiPrefix = '3056301006072a8648ce3d020106052b8104000a034200';
    const der = toBytes(`0x${spkiPrefix}${uncompressed.slice(2)}`);

    expect(addressFromDerPublicKey(der).toLowerCase()).toBe(account.address.toLowerCase());
  });
});

describe('signature normalisation', () => {
  const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const HALF_N = N / 2n;

  /**
   * Mirrors the normalisation in `kms.ts`, then proves the resulting signature still recovers to the
   * right address once the parity is searched. This is the property that makes the flip safe.
   */
  it('a flipped high-s signature still recovers the signer via the other parity', async () => {
    const account = privateKeyToAccount(
      '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
    );
    const digest = keccak256(new TextEncoder().encode('collector high-s probe'));
    const original = await account.sign({hash: digest});

    const r = BigInt(`0x${original.slice(2, 66)}`);
    const s = BigInt(`0x${original.slice(66, 130)}`);
    expect(s).toBeLessThanOrEqual(HALF_N); // viem already normalises

    // Force the malleable twin, the shape KMS can legitimately return.
    const highS = N - s;
    expect(highS).toBeGreaterThan(HALF_N);

    const renormalised = highS > HALF_N ? N - highS : highS;
    expect(renormalised).toBe(s);

    let recoveredCorrectly = false;
    for (const v of [27, 28]) {
      const sig = `0x${r.toString(16).padStart(64, '0')}${renormalised
        .toString(16)
        .padStart(64, '0')}${v.toString(16).padStart(2, '0')}` as `0x${string}`;
      const recovered = await recoverAddress({hash: digest, signature: sig});
      if (recovered.toLowerCase() === account.address.toLowerCase()) recoveredCorrectly = true;
    }
    expect(recoveredCorrectly).toBe(true);
  });
});

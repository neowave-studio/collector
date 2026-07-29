import {describe, expect, it} from 'vitest';
import {encodePacked, keccak256, type Hex} from 'viem';
import {
  assertValidPartition,
  buildProof,
  computeRoot,
  findLeafForWeight,
  houseMarginHolds,
  leafHashes,
  verifyProof,
  type PoolLeaf,
} from '../src/lib/merkle.js';

/**
 * Cross-implementation vectors.
 *
 * These roots are produced by `contracts/test/unit/MerkleTreeLib.t.sol::test_printCrossImplementationVectors`
 * over leaves `keccak256(abi.encodePacked("collector-test-leaf", uint256 i))`. If this file and the
 * Solidity library ever disagree, `settle` stops accepting backend-generated proofs and users can no
 * longer self-settle — so this test is a release blocker, not a nicety.
 */
const SOLIDITY_ROOTS: Record<number, Hex> = {
  1: '0x4835370517fde87f766439617fc0cf076d213c67f7a6c5b92f6f68362401c8bf',
  2: '0x558d03b7449787283f5f61545772e0f13d0aef6925c0895fd2686947cefb6453',
  3: '0x378cb0f80487755a20932b4c4608448ed97079dfc3ee4421a8d336ede14df364',
  4: '0x8864149aa405de06bd0728ebec68a30c77a7f70bb5da1967391a460d31a545ea',
  5: '0xa7caef45141d78caa32578d5bcc45965b7e51f8eac28a6c06dde581247656751',
};

function testLeaves(n: number): Hex[] {
  return Array.from({length: n}, (_, i) => keccak256(encodePacked(['string', 'uint256'], ['collector-test-leaf', BigInt(i)])));
}

describe('canonical Merkle tree', () => {
  it('matches the Solidity implementation byte-for-byte', () => {
    for (const [n, expected] of Object.entries(SOLIDITY_ROOTS)) {
      expect(computeRoot(testLeaves(Number(n))), `tree of ${n} leaves`).toBe(expected);
    }
  });

  it('produces proofs that verify for every leaf of every tree size', () => {
    for (let n = 1; n <= 33; n++) {
      const hashes = testLeaves(n);
      const root = computeRoot(hashes);
      for (let i = 0; i < n; i++) {
        expect(verifyProof(buildProof(hashes, i), root, hashes[i]!), `leaf ${i} of ${n}`).toBe(true);
      }
    }
  });

  it('rejects a proof presented for the wrong leaf', () => {
    const hashes = testLeaves(7);
    const root = computeRoot(hashes);
    expect(verifyProof(buildProof(hashes, 3), root, hashes[4]!)).toBe(false);
  });

  it('single-leaf tree has the leaf as its root and an empty proof', () => {
    const hashes = testLeaves(1);
    expect(computeRoot(hashes)).toBe(hashes[0]);
    expect(buildProof(hashes, 0)).toEqual([]);
  });
});

describe('pool partition validation', () => {
  const packId = keccak256(new TextEncoder().encode('PKMN50'));

  const good: PoolLeaf[] = [
    {tokenId: 1n, cumBefore: 0n, weight: 80n, priceRef: 30_000_000n},
    {tokenId: 2n, cumBefore: 80n, weight: 15n, priceRef: 60_000_000n},
    {tokenId: 3n, cumBefore: 95n, weight: 4n, priceRef: 110_000_000n},
    {tokenId: 4n, cumBefore: 99n, weight: 1n, priceRef: 800_000_000n},
  ];

  it('accepts a gap-free ascending partition', () => {
    const {totalWeight, maxPriceRef} = assertValidPartition(good);
    expect(totalWeight).toBe(100n);
    expect(maxPriceRef).toBe(800_000_000n);
  });

  it('rejects a gap', () => {
    const bad = structuredClone(good);
    bad[1]!.cumBefore = 81n;
    expect(() => assertValidPartition(bad)).toThrow(/gap or overlap/);
  });

  it('rejects an overlap', () => {
    const bad = structuredClone(good);
    bad[2]!.cumBefore = 90n;
    expect(() => assertValidPartition(bad)).toThrow(/gap or overlap/);
  });

  it('rejects a zero-weight leaf', () => {
    const bad = structuredClone(good);
    bad[1]!.weight = 0n;
    expect(() => assertValidPartition(bad)).toThrow(/weight must be > 0/);
  });

  it('rejects the same card twice', () => {
    const bad = structuredClone(good);
    bad[1]!.tokenId = 1n;
    expect(() => assertValidPartition(bad)).toThrow(/strictly ascending/);
  });

  it('maps every weight in range to exactly one card', () => {
    for (let w = 0n; w < 100n; w++) {
      const {leaf, index} = findLeafForWeight(good, w);
      const matches = good.filter((l) => w >= l.cumBefore && w < l.cumBefore + l.weight);
      expect(matches).toHaveLength(1);
      expect(leaf.tokenId).toBe(good[index]!.tokenId);
    }
  });

  it('mirrors the on-chain house-margin invariant', () => {
    // 0.85 x 45.40 = 38.59 <= 50 x 0.90 = 45.00
    expect(
      houseMarginHolds({leaves: good, pricePerRip: 50_000_000n, buybackBps: 8500n, houseMarginBps: 1000n}),
    ).toBe(true);

    // Every card worth 100 USDC at an 85% buyback on a 50 USDC rip is a money printer.
    const arbitrageable = good.map((l) => ({...l, priceRef: 100_000_000n}));
    expect(
      houseMarginHolds({
        leaves: arbitrageable,
        pricePerRip: 50_000_000n,
        buybackBps: 8500n,
        houseMarginBps: 1000n,
      }),
    ).toBe(false);
  });

  it('leaf hashes bind packId and version so a proof cannot be replayed across pools', () => {
    const a = leafHashes(packId, 1n, good);
    const b = leafHashes(packId, 2n, good);
    const c = leafHashes(keccak256(new TextEncoder().encode('PKMN250')), 1n, good);
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(c);
  });
});

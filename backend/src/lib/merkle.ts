import {encodeAbiParameters, keccak256, concatHex, type Hex} from 'viem';

/**
 * The canonical Merkle construction, mirroring `contracts/src/libraries/MerkleTreeLib.sol` exactly.
 *
 * Three independent implementations must agree byte-for-byte — this one, the Solidity library that
 * `commitPool` uses to BUILD the root, and the offline proof tool users run when we are unavailable.
 * `test/merkle.test.ts` pins the same vectors that `test/unit/MerkleTreeLib.t.sol` prints, so a
 * divergence fails CI on both sides rather than silently breaking self-settlement.
 *
 *   level_0        = leaf hashes in ascending leaf index order
 *   level_{k+1}[j] = hashPair(level_k[2j], level_k[2j+1])
 *   trailing odd   = promoted unchanged
 *   hashPair(a,b)  = keccak256(min(a,b) || max(a,b))     // commutative / sorted pairs
 */

/** Mirrors `PoolLib.LEAF_DOMAIN_TAG`. */
export const LEAF_DOMAIN_TAG = keccak256(new TextEncoder().encode('collector.gacha.pool.leaf.v1'));

export interface PoolLeaf {
  tokenId: bigint;
  cumBefore: bigint;
  weight: bigint;
  priceRef: bigint;
}

export function hashPair(a: Hex, b: Hex): Hex {
  return BigInt(a) < BigInt(b) ? keccak256(concatHex([a, b])) : keccak256(concatHex([b, a]));
}

/** Mirrors `PoolLib.leafHash`. */
export function leafHash(packId: Hex, version: bigint, index: bigint, leaf: PoolLeaf): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        {type: 'bytes32'},
        {type: 'bytes32'},
        {type: 'uint256'},
        {type: 'uint256'},
        {type: 'uint256'},
        {type: 'uint256'},
        {type: 'uint256'},
        {type: 'uint256'},
      ],
      [LEAF_DOMAIN_TAG, packId, version, index, leaf.tokenId, leaf.cumBefore, leaf.weight, leaf.priceRef],
    ),
  );
}

export function leafHashes(packId: Hex, version: bigint, leaves: readonly PoolLeaf[]): Hex[] {
  return leaves.map((leaf, i) => leafHash(packId, version, BigInt(i), leaf));
}

export function computeRoot(hashes: readonly Hex[]): Hex {
  if (hashes.length === 0) throw new Error('empty tree');
  let level = [...hashes];
  while (level.length > 1) {
    const next: Hex[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = level[i + 1];
      next.push(right === undefined ? left : hashPair(left, right));
    }
    level = next;
  }
  return level[0]!;
}

/** Inclusion proof for `index`, verifiable by OpenZeppelin's `MerkleProof.verifyCalldata`. */
export function buildProof(hashes: readonly Hex[], index: number): Hex[] {
  if (index < 0 || index >= hashes.length) throw new Error(`leaf index ${index} out of range`);

  const proof: Hex[] = [];
  let level = [...hashes];
  let idx = index;

  while (level.length > 1) {
    const sibling = idx ^ 1;
    // A trailing even-indexed node in an odd-length level is promoted and has no sibling.
    if (sibling < level.length) proof.push(level[sibling]!);

    const next: Hex[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = level[i + 1];
      next.push(right === undefined ? left : hashPair(left, right));
    }
    level = next;
    idx = Math.floor(idx / 2);
  }
  return proof;
}

export function verifyProof(proof: readonly Hex[], root: Hex, leaf: Hex): boolean {
  let computed = leaf;
  for (const node of proof) computed = hashPair(computed, node);
  return computed.toLowerCase() === root.toLowerCase();
}

/** The leaf whose half-open slice `[cumBefore, cumBefore + weight)` contains `winningWeight`. */
export function findLeafForWeight(leaves: readonly PoolLeaf[], winningWeight: bigint): {leaf: PoolLeaf; index: number} {
  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i]!;
    if (winningWeight >= leaf.cumBefore && winningWeight < leaf.cumBefore + leaf.weight) {
      return {leaf, index: i};
    }
  }
  throw new Error(`no slice contains weight ${winningWeight} — the pool file does not match the committed version`);
}

/**
 * Re-checks locally what `commitPool` enforces on-chain. Run before submitting a pool so a bad file is
 * caught in CI rather than as a reverted transaction, and run again by the proof tool so a user can
 * confirm the file they downloaded is the partition that was actually committed.
 */
export function assertValidPartition(leaves: readonly PoolLeaf[]): {totalWeight: bigint; maxPriceRef: bigint} {
  if (leaves.length === 0) throw new Error('pool is empty');

  let cum = 0n;
  let lastTokenId = -1n;
  let maxPriceRef = 0n;

  leaves.forEach((leaf, i) => {
    if (leaf.cumBefore !== cum) {
      throw new Error(`leaf ${i}: cumBefore ${leaf.cumBefore} should be ${cum} (gap or overlap in the partition)`);
    }
    if (leaf.weight <= 0n) throw new Error(`leaf ${i}: weight must be > 0`);
    if (i > 0 && leaf.tokenId <= lastTokenId) {
      throw new Error(`leaf ${i}: tokenIds must be strictly ascending (duplicate card in the pool?)`);
    }
    cum += leaf.weight;
    lastTokenId = leaf.tokenId;
    if (leaf.priceRef > maxPriceRef) maxPriceRef = leaf.priceRef;
  });

  return {totalWeight: cum, maxPriceRef};
}

/** Mirrors `PoolLib.houseMarginHolds` — integer form, no division, so rounding cannot be gamed. */
export function houseMarginHolds(args: {
  leaves: readonly PoolLeaf[];
  pricePerRip: bigint;
  buybackBps: bigint;
  houseMarginBps: bigint;
}): boolean {
  const {leaves, pricePerRip, buybackBps, houseMarginBps} = args;
  let weightedSum = 0n;
  let totalWeight = 0n;
  for (const leaf of leaves) {
    weightedSum += leaf.weight * leaf.priceRef;
    totalWeight += leaf.weight;
  }
  return buybackBps * weightedSum <= pricePerRip * (10_000n - houseMarginBps) * totalWeight;
}

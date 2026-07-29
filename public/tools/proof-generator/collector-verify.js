/**
 * Collector — offline pool verifier and settlement-proof generator.
 *
 * ZERO DEPENDENCIES, BY DESIGN. This file implements keccak-256 from the Keccak specification rather
 * than importing one, because the entire point of this tool is that it works when we are gone: no
 * CDN, no npm registry, no backend, no network at all. Save this folder to a USB stick and it still
 * generates a valid transaction.
 *
 * What it lets you do without trusting us:
 *   1. verify that a published pool file really is the odds committed on-chain;
 *   2. work out which card a revealed draw must pay out;
 *   3. build the exact calldata that delivers it to you.
 *
 * Cross-checked against `contracts/test/unit/MerkleTreeLib.t.sol` and `backend/test/merkle.test.ts`;
 * all three must produce identical roots. Run `node cli.mjs selftest` to confirm this copy is intact.
 */

// ===============================================================================================
// keccak-256
// ===============================================================================================

const MASK64 = (1n << 64n) - 1n;

const ROUND_CONSTANTS = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

/** Rotation offsets, indexed by lane `x + 5y`. */
const ROTATION = [
  0, 1, 62, 28, 27,
  36, 44, 6, 55, 20,
  3, 10, 43, 25, 39,
  41, 45, 15, 21, 8,
  18, 2, 61, 56, 14,
];

function rotl64(value, shift) {
  const n = BigInt(shift % 64);
  if (n === 0n) return value & MASK64;
  return ((value << n) | (value >> (64n - n))) & MASK64;
}

function keccakF1600(lanes) {
  for (let round = 0; round < 24; round++) {
    // theta
    const c = new Array(5);
    for (let x = 0; x < 5; x++) {
      c[x] = lanes[x] ^ lanes[x + 5] ^ lanes[x + 10] ^ lanes[x + 15] ^ lanes[x + 20];
    }
    const d = new Array(5);
    for (let x = 0; x < 5; x++) {
      d[x] = c[(x + 4) % 5] ^ rotl64(c[(x + 1) % 5], 1);
    }
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) lanes[x + 5 * y] ^= d[x];
    }

    // rho + pi
    const b = new Array(25);
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl64(lanes[x + 5 * y], ROTATION[x + 5 * y]);
      }
    }

    // chi
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        lanes[x + 5 * y] = b[x + 5 * y] ^ (~b[((x + 1) % 5) + 5 * y] & MASK64 & b[((x + 2) % 5) + 5 * y]);
      }
    }

    // iota
    lanes[0] ^= ROUND_CONSTANTS[round];
  }
}

/**
 * keccak-256 over a byte array.
 * @param {Uint8Array} input
 * @returns {Uint8Array} 32 bytes
 */
export function keccak256(input) {
  const RATE = 136; // 200 - 2*32
  const lanes = new Array(25).fill(0n);

  // Original Keccak padding (0x01 … 0x80) — this is what Ethereum uses, NOT SHA-3's 0x06.
  const padded = new Uint8Array(Math.ceil((input.length + 1) / RATE) * RATE);
  padded.set(input);
  padded[input.length] = 0x01;
  padded[padded.length - 1] |= 0x80;

  for (let offset = 0; offset < padded.length; offset += RATE) {
    for (let lane = 0; lane < RATE / 8; lane++) {
      let value = 0n;
      for (let byte = 7; byte >= 0; byte--) {
        value = (value << 8n) | BigInt(padded[offset + lane * 8 + byte]);
      }
      lanes[lane] ^= value;
    }
    keccakF1600(lanes);
  }

  const out = new Uint8Array(32);
  for (let lane = 0; lane < 4; lane++) {
    let value = lanes[lane];
    for (let byte = 0; byte < 8; byte++) {
      out[lane * 8 + byte] = Number(value & 0xffn);
      value >>= 8n;
    }
  }
  return out;
}

// ===============================================================================================
// hex / byte helpers
// ===============================================================================================

export function toHex(bytes) {
  let out = '0x';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function fromHex(hex) {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error(`odd-length hex: ${hex}`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function utf8(text) {
  return new TextEncoder().encode(text);
}

/** A single ABI word: 32-byte big-endian. */
export function word(value) {
  const out = new Uint8Array(32);
  let v = typeof value === 'bigint' ? value : BigInt(value);
  if (v < 0n) throw new Error('negative values are not encodable');
  for (let i = 31; i >= 0 && v > 0n; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

export function concat(...chunks) {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function bytes32(hex) {
  const bytes = fromHex(hex);
  if (bytes.length !== 32) throw new Error(`expected 32 bytes, got ${bytes.length}: ${hex}`);
  return bytes;
}

// ===============================================================================================
// Leaf hashing — mirrors PoolLib.leafHash
// ===============================================================================================

/** keccak256("collector.gacha.pool.leaf.v1") — must equal `PoolLib.LEAF_DOMAIN_TAG`. */
export const LEAF_DOMAIN_TAG = toHex(keccak256(utf8('collector.gacha.pool.leaf.v1')));

export function leafHash(packId, version, index, leaf) {
  return toHex(
    keccak256(
      concat(
        bytes32(LEAF_DOMAIN_TAG),
        bytes32(packId),
        word(version),
        word(index),
        word(leaf.tokenId),
        word(leaf.cumBefore),
        word(leaf.weight),
        word(leaf.priceRef),
      ),
    ),
  );
}

// ===============================================================================================
// Merkle — mirrors MerkleTreeLib
// ===============================================================================================

export function hashPair(a, b) {
  const [lo, hi] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  return toHex(keccak256(concat(bytes32(lo), bytes32(hi))));
}

export function computeRoot(hashes) {
  if (hashes.length === 0) throw new Error('empty tree');
  let level = [...hashes];
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length ? hashPair(level[i], level[i + 1]) : level[i]);
    }
    level = next;
  }
  return level[0];
}

export function buildProof(hashes, index) {
  if (index < 0 || index >= hashes.length) throw new Error(`leaf index ${index} out of range`);
  const proof = [];
  let level = [...hashes];
  let idx = index;

  while (level.length > 1) {
    const sibling = idx ^ 1;
    // A trailing even-indexed node in an odd-length level is promoted, so it has no sibling.
    if (sibling < level.length) proof.push(level[sibling]);

    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length ? hashPair(level[i], level[i + 1]) : level[i]);
    }
    level = next;
    idx = Math.floor(idx / 2);
  }
  return proof;
}

export function verifyProof(proof, root, leaf) {
  let computed = leaf;
  for (const node of proof) computed = hashPair(computed, node);
  return computed.toLowerCase() === root.toLowerCase();
}

// ===============================================================================================
// Pool file verification
// ===============================================================================================

/**
 * Re-derives everything the contract enforced, from the published file alone.
 *
 * If this returns `ok`, then: the odds tile the whole weight range exactly once (no gaps, no
 * overlaps, no duplicate card), and the root you can see on-chain is the root of THIS file. That is
 * the entire "provably fair" claim, checked by you rather than asserted by us.
 */
export function verifyPoolFile(file, onChainRoot) {
  const problems = [];

  const packId = file.packId;
  const version = BigInt(file.version);
  const cards = [...file.cards].sort((a, b) => a.leafIndex - b.leafIndex);

  let cum = 0n;
  let lastTokenId = -1n;
  const hashes = [];

  cards.forEach((card, i) => {
    if (card.leafIndex !== i) problems.push(`card ${i}: leafIndex is ${card.leafIndex}, expected ${i}`);

    const leaf = {
      tokenId: BigInt(card.tokenId),
      cumBefore: BigInt(card.cumBefore),
      weight: BigInt(card.weight),
      priceRef: BigInt(card.priceRef),
    };

    if (leaf.cumBefore !== cum) {
      problems.push(`card ${i}: cumBefore is ${leaf.cumBefore}, expected ${cum} — GAP OR OVERLAP in the odds`);
    }
    if (leaf.weight <= 0n) problems.push(`card ${i}: weight must be greater than zero`);
    if (i > 0 && leaf.tokenId <= lastTokenId) {
      problems.push(`card ${i}: tokenIds must strictly ascend — the same card may appear only once`);
    }

    const computed = leafHash(packId, version, BigInt(i), leaf);
    if (card.leafHash && card.leafHash.toLowerCase() !== computed.toLowerCase()) {
      problems.push(`card ${i}: stated leafHash does not match the one derived from its own fields`);
    }
    hashes.push(computed);

    cum += leaf.weight;
    lastTokenId = leaf.tokenId;
  });

  if (cum !== BigInt(file.totalWeight)) {
    problems.push(`totalWeight is ${file.totalWeight} but the card weights sum to ${cum}`);
  }

  const root = hashes.length > 0 ? computeRoot(hashes) : null;
  if (root && file.merkleRoot && root.toLowerCase() !== file.merkleRoot.toLowerCase()) {
    problems.push(`the file states root ${file.merkleRoot} but its cards produce ${root}`);
  }
  if (onChainRoot && root && root.toLowerCase() !== onChainRoot.toLowerCase()) {
    problems.push(
      `THIS FILE DOES NOT MATCH THE CHAIN. On-chain root is ${onChainRoot}, this file produces ${root}. ` +
        `Do not trust these odds.`,
    );
  }

  return {ok: problems.length === 0, problems, computedRoot: root, hashes, totalWeight: cum};
}

/** The one card a winning weight can pay out. Returns its index, or throws if the file is broken. */
export function findCardForWeight(file, winningWeight) {
  const target = BigInt(winningWeight);
  const matches = file.cards.filter(
    (c) => target >= BigInt(c.cumBefore) && target < BigInt(c.cumBefore) + BigInt(c.weight),
  );
  if (matches.length === 0) {
    throw new Error(`no card covers weight ${winningWeight} — this pool file has a gap and is not the committed one`);
  }
  if (matches.length > 1) {
    throw new Error(`weight ${winningWeight} is covered by ${matches.length} cards — this pool file overlaps`);
  }
  return matches[0];
}

// ===============================================================================================
// Calldata
// ===============================================================================================

function selector(signature) {
  return keccak256(utf8(signature)).slice(0, 4);
}

/**
 * Builds the calldata for `claimAfterTimeout(uint256, LeafProof)` (or `settle` / `claimUnavailable`).
 *
 * `claimAfterTimeout` is the one to use if we are unreachable: it is permissionless, it is NOT
 * pausable, and once the buyback window has passed anyone can call it — the card still goes to the
 * draw's owner, not the caller.
 */
export function buildCalldata({method = 'claimAfterTimeout', drawId, card, proof}) {
  const signature = `${method}(uint256,(uint256,uint256,uint256,uint256,uint256,bytes32[]))`;

  const head = concat(
    word(drawId),
    word(0x40), // offset to the LeafProof tuple
  );

  const tuple = concat(
    word(card.tokenId),
    word(card.cumBefore),
    word(card.weight),
    word(card.priceRef),
    word(card.leafIndex),
    word(0xc0), // offset to the bytes32[] proof, relative to the tuple's own start
    word(proof.length),
    ...proof.map((node) => bytes32(node)),
  );

  return toHex(concat(selector(signature), head, tuple));
}

export function buildRefundCalldata(drawId) {
  return toHex(concat(selector('refundStuckRip(uint256)'), word(drawId)));
}

// ===============================================================================================
// Self-test
// ===============================================================================================

/**
 * Confirms this copy of the file is intact and matches the contracts.
 * The Merkle roots below are printed by `MerkleTreeLibTest::test_printCrossImplementationVectors`.
 */
export function selfTest() {
  const results = [];
  const check = (name, actual, expected) =>
    results.push({name, pass: actual.toLowerCase() === expected.toLowerCase(), actual, expected});

  check('keccak256("")', toHex(keccak256(utf8(''))),
    '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
  check('keccak256("abc")', toHex(keccak256(utf8('abc'))),
    '0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45');
  check('keccak256("testing")', toHex(keccak256(utf8('testing'))),
    '0x5f16f4c7f149ac4f9510d9cf8cf384038ad348b3bcdc01915f95de12df9d1b02');

  // Test leaves: keccak256(abi.encodePacked("collector-test-leaf", uint256 i))
  const testLeaves = (n) =>
    Array.from({length: n}, (_, i) => toHex(keccak256(concat(utf8('collector-test-leaf'), word(i)))));

  const expectedRoots = {
    1: '0x4835370517fde87f766439617fc0cf076d213c67f7a6c5b92f6f68362401c8bf',
    2: '0x558d03b7449787283f5f61545772e0f13d0aef6925c0895fd2686947cefb6453',
    3: '0x378cb0f80487755a20932b4c4608448ed97079dfc3ee4421a8d336ede14df364',
    4: '0x8864149aa405de06bd0728ebec68a30c77a7f70bb5da1967391a460d31a545ea',
    5: '0xa7caef45141d78caa32578d5bcc45965b7e51f8eac28a6c06dde581247656751',
  };
  for (const [n, expected] of Object.entries(expectedRoots)) {
    check(`merkle root of ${n} leaves`, computeRoot(testLeaves(Number(n))), expected);
  }

  // Every proof must verify against its own root, including the odd-length promotion cases.
  let proofsOk = true;
  for (let n = 1; n <= 17; n++) {
    const hashes = testLeaves(n);
    const root = computeRoot(hashes);
    for (let i = 0; i < n; i++) {
      if (!verifyProof(buildProof(hashes, i), root, hashes[i])) proofsOk = false;
    }
  }
  results.push({name: 'all proofs verify (trees of 1..17 leaves)', pass: proofsOk, actual: proofsOk, expected: true});

  return {ok: results.every((r) => r.pass), results};
}

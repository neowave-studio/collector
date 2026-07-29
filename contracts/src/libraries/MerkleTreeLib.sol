// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

/// @title MerkleTreeLib
/// @notice The suite's ONE canonical Merkle tree construction. Three independent implementations must
///         agree byte-for-byte: this library (used by `commitPool` to build the root on-chain), the
///         backend proof generator (`backend/src/lib/merkle.ts`), and the offline user-facing
///         proof tool (`tools/proof-generator/`). `test/unit/MerkleTreeLib.t.sol` pins vectors that
///         the other two implementations are tested against.
///
/// Canonical construction:
///   level_0                = leaf hashes, in ascending logical leaf index order (n >= 1)
///   level_{k+1}[j]         = hashPair(level_k[2j], level_k[2j+1])
///   trailing odd node      = promoted unchanged to the next level
///   root                   = the single node of the last level (for n == 1, root == leaf)
///   hashPair(a, b)         = keccak256(min(a,b) || max(a,b))     // commutative / sorted pairs
///
/// Commutative pair hashing is chosen so that proofs verify with OpenZeppelin's audited
/// `MerkleProof.verifyCalldata` and need no left/right direction bitmap.
///
/// @dev Second-preimage note for auditors: an internal node is a 64-byte keccak preimage while a leaf
///      is the 256-byte ABI encoding of the tagged tuple in `PoolLib.leafHash`. Passing an internal
///      node off as a leaf would require a keccak preimage collision, and `GachaMachine.settle`
///      additionally requires the recovered slice to contain the VRF weight and the tokenId to be
///      vault-held for the draw's pack, so a forged "leaf" cannot release a card.
library MerkleTreeLib {
    error EmptyTree();

    function hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32 value) {
        return a < b ? _hash(a, b) : _hash(b, a);
    }

    function _hash(bytes32 a, bytes32 b) private pure returns (bytes32 value) {
        assembly ("memory-safe") {
            mstore(0x00, a)
            mstore(0x20, b)
            value := keccak256(0x00, 0x40)
        }
    }

    /// @notice Copies an accumulated storage array of leaf hashes into memory and folds it.
    /// @dev Used by `finalizePool`, where the leaves were pushed across several chunk transactions.
    function computeRootFromStorage(bytes32[] storage leaves) internal view returns (bytes32) {
        uint256 n = leaves.length;
        if (n == 0) revert EmptyTree();
        bytes32[] memory buf = new bytes32[](n);
        for (uint256 i; i < n; ++i) {
            buf[i] = leaves[i];
        }
        return computeRoot(buf);
    }

    /// @notice Folds `leaves` into the canonical root.
    /// @dev Destructive: reuses `leaves` as scratch space to avoid O(n) extra memory per level.
    ///      Callers that still need the leaf hashes must copy them first.
    function computeRoot(bytes32[] memory leaves) internal pure returns (bytes32) {
        uint256 n = leaves.length;
        if (n == 0) revert EmptyTree();
        while (n > 1) {
            uint256 w;
            for (uint256 i; i < n; i += 2) {
                unchecked {
                    leaves[w++] = (i + 1 < n) ? hashPair(leaves[i], leaves[i + 1]) : leaves[i];
                }
            }
            n = w;
        }
        return leaves[0];
    }
}

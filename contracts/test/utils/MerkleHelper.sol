// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MerkleTreeLib} from "../../src/libraries/MerkleTreeLib.sol";

/// @notice Reference proof generator for the canonical tree in {MerkleTreeLib}.
/// @dev Independent re-implementation of the *proving* side: `MerkleTreeLib` only folds a level, this
///      walks the levels and collects siblings. If the two ever disagree, `settle` stops verifying and
///      the unit tests fail loudly. The backend (`merkle.ts`) and the offline tool implement the same
///      algorithm and are pinned to the vectors in `test/unit/MerkleTreeLib.t.sol`.
library MerkleHelper {
    /// @notice Builds the inclusion proof for `index` in the canonical tree over `leaves`.
    function buildProof(bytes32[] memory leaves, uint256 index) internal pure returns (bytes32[] memory proof) {
        uint256 n = leaves.length;
        require(index < n, "index out of range");

        bytes32[] memory tmp = new bytes32[](128);
        uint256 count;

        bytes32[] memory level = new bytes32[](n);
        for (uint256 i; i < n; ++i) {
            level[i] = leaves[i];
        }

        uint256 idx = index;
        while (n > 1) {
            uint256 sibling = idx ^ 1;
            // A trailing even-indexed node in an odd-length level has no sibling: it is promoted
            // unchanged, so it contributes nothing to the proof.
            if (sibling < n) {
                tmp[count++] = level[sibling];
            }

            uint256 w;
            for (uint256 i; i < n; i += 2) {
                level[w++] = (i + 1 < n) ? MerkleTreeLib.hashPair(level[i], level[i + 1]) : level[i];
            }
            n = w;
            idx /= 2;
        }

        proof = new bytes32[](count);
        for (uint256 i; i < count; ++i) {
            proof[i] = tmp[i];
        }
    }

    /// @notice Non-destructive root, for assertions.
    function root(bytes32[] memory leaves) internal pure returns (bytes32) {
        bytes32[] memory copy = new bytes32[](leaves.length);
        for (uint256 i; i < leaves.length; ++i) {
            copy[i] = leaves[i];
        }
        return MerkleTreeLib.computeRoot(copy);
    }
}

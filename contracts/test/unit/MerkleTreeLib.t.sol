// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {MerkleTreeLib} from "../../src/libraries/MerkleTreeLib.sol";
import {MerkleHelper} from "../utils/MerkleHelper.sol";

/// @notice Pins the canonical tree so the three implementations (this library, the backend's
///         `merkle.ts`, and the offline proof tool) can never silently diverge. If they diverge,
///         `settle` stops accepting backend-produced proofs and users cannot self-settle.
contract MerkleTreeLibTest is Test {
    function _leaves(uint256 n) internal pure returns (bytes32[] memory out) {
        out = new bytes32[](n);
        for (uint256 i; i < n; ++i) {
            out[i] = keccak256(abi.encodePacked("collector-test-leaf", i));
        }
    }

    /// @dev Independent, deliberately naive re-implementation of the spec in `MerkleTreeLib`'s
    ///      docstring. Written from the description rather than from the library's code.
    function _referenceRoot(bytes32[] memory leaves) internal pure returns (bytes32) {
        bytes32[] memory level = leaves;
        while (level.length > 1) {
            uint256 next = (level.length + 1) / 2;
            bytes32[] memory up = new bytes32[](next);
            for (uint256 i; i < next; ++i) {
                uint256 l = 2 * i;
                uint256 r = l + 1;
                if (r < level.length) {
                    up[i] = level[l] < level[r]
                        ? keccak256(abi.encodePacked(level[l], level[r]))
                        : keccak256(abi.encodePacked(level[r], level[l]));
                } else {
                    up[i] = level[l];
                }
            }
            level = up;
        }
        return level[0];
    }

    function test_singleLeafTreeRootIsTheLeaf() public pure {
        bytes32[] memory leaves = _leaves(1);
        assertEq(MerkleHelper.root(leaves), leaves[0]);
        assertEq(MerkleHelper.buildProof(leaves, 0).length, 0);
    }

    function test_matchesIndependentReferenceImplementation() public pure {
        for (uint256 n = 1; n <= 33; ++n) {
            bytes32[] memory leaves = _leaves(n);
            assertEq(MerkleHelper.root(leaves), _referenceRoot(leaves), "root mismatch vs reference");
        }
    }

    /// @notice Every leaf of every tree size must produce a proof OpenZeppelin's verifier accepts —
    ///         including the odd-length promotion cases, which are where hand-rolled trees usually
    ///         break.
    function test_everyProofVerifies() public pure {
        for (uint256 n = 1; n <= 33; ++n) {
            bytes32[] memory leaves = _leaves(n);
            bytes32 root = MerkleHelper.root(leaves);
            for (uint256 i; i < n; ++i) {
                bytes32[] memory proof = MerkleHelper.buildProof(leaves, i);
                assertTrue(MerkleProof.verify(proof, root, leaves[i]), "proof rejected");
            }
        }
    }

    function test_proofForWrongLeafFails() public pure {
        bytes32[] memory leaves = _leaves(7);
        bytes32 root = MerkleHelper.root(leaves);
        bytes32[] memory proof = MerkleHelper.buildProof(leaves, 3);
        assertFalse(MerkleProof.verify(proof, root, leaves[4]));
    }

    function testFuzz_rootIsOrderSensitive(uint8 rawN, uint8 rawI) public pure {
        uint256 n = uint256(rawN) % 30 + 2;
        uint256 i = uint256(rawI) % (n - 1);

        bytes32[] memory a = _leaves(n);
        bytes32[] memory b = _leaves(n);
        (b[i], b[i + 1]) = (b[i + 1], b[i]);

        // Pair hashing is commutative, so swapping the two halves of a leaf PAIR is a no-op; swapping
        // across a pair boundary must change the root. This documents exactly how much order matters.
        if (i % 2 == 0) {
            assertEq(MerkleHelper.root(a), MerkleHelper.root(b), "intra-pair swap should not change root");
        } else {
            assertTrue(MerkleHelper.root(a) != MerkleHelper.root(b), "cross-pair swap must change root");
        }
    }

    function test_emptyTreeReverts() public {
        bytes32[] memory empty = new bytes32[](0);
        vm.expectRevert(MerkleTreeLib.EmptyTree.selector);
        this.rootOf(empty);
    }

    function rootOf(bytes32[] memory leaves) external pure returns (bytes32) {
        return MerkleTreeLib.computeRoot(leaves);
    }

    /// @notice Prints the cross-implementation test vectors. `backend/test/merkle.test.ts` and
    ///         `tools/proof-generator` assert the same values.
    function test_printCrossImplementationVectors() public pure {
        for (uint256 n = 1; n <= 5; ++n) {
            console2.log("leaves", n);
            console2.logBytes32(MerkleHelper.root(_leaves(n)));
        }
    }
}

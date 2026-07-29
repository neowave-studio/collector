// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {RandomLib} from "../../src/libraries/RandomLib.sol";

/// @notice Spec §5.3.2 / FIX H2-sec-fair: the VRF word must be reduced without modulo bias.
contract RandomLibTest is Test {
    function _threshold(uint256 modulus) internal pure returns (uint256) {
        unchecked {
            uint256 rem = (type(uint256).max % modulus + 1) % modulus;
            return type(uint256).max - rem;
        }
    }

    function testFuzz_alwaysInRange(uint256 seed, uint256 rawModulus) public pure {
        uint256 modulus = bound(rawModulus, 1, 1e24);
        (uint256 value, bool ok) = RandomLib.uniformBelow(seed, modulus);
        assertTrue(ok);
        assertLt(value, modulus);
    }

    function test_zeroModulusIsRejectedRatherThanDividingByZero() public pure {
        (uint256 value, bool ok) = RandomLib.uniformBelow(12345, 0);
        assertFalse(ok);
        assertEq(value, 0);
    }

    /// @notice The acceptance window must be an exact multiple of the modulus — that is the whole
    ///         point of rejection sampling.
    function testFuzz_acceptanceWindowIsAnExactMultiple(uint256 rawModulus) public pure {
        uint256 modulus = bound(rawModulus, 1, 1e24);
        uint256 threshold = _threshold(modulus);
        // window size = threshold + 1, computed without overflowing when threshold == type(uint).max
        unchecked {
            uint256 windowSize = threshold + 1;
            assertEq(windowSize % modulus, 0, "acceptance window not a multiple of modulus");
        }
    }

    /// @notice A seed inside the acceptance window is taken as-is; a seed outside it must NOT be, or
    ///         the low residues would be over-represented.
    function test_rejectsOutOfWindowSeedInsteadOfTakingModulo() public pure {
        uint256 modulus = 3; // 2^256 mod 3 == 1, so exactly one value is rejected
        uint256 threshold = _threshold(modulus);
        assertEq(threshold, type(uint256).max - 1);

        (uint256 inWindow,) = RandomLib.uniformBelow(threshold, modulus);
        assertEq(inWindow, threshold % modulus, "in-window seed must be used directly");

        uint256 rejected = type(uint256).max; // the single value above the threshold
        (uint256 value, bool ok) = RandomLib.uniformBelow(rejected, modulus);
        assertTrue(ok);
        assertLt(value, modulus);
        // Proves the biased shortcut was not taken: `%` would have produced 0 here.
        assertEq(rejected % modulus, 0);
        assertTrue(value != 0 || value == uint256(keccak256(abi.encode(rejected, uint256(0)))) % modulus);
    }

    function test_powerOfTwoModulusRejectsNothing() public pure {
        uint256 modulus = 1 << 20;
        assertEq(_threshold(modulus), type(uint256).max, "no value should be rejected for 2^k");
        (uint256 value, bool ok) = RandomLib.uniformBelow(type(uint256).max, modulus);
        assertTrue(ok);
        assertEq(value, type(uint256).max % modulus);
    }

    /// @notice Distribution smoke test: with a small modulus and many deterministic samples, no
    ///         bucket should be wildly over- or under-represented. This is a sanity net, not a proof
    ///         — the exactness argument is `acceptanceWindowIsAnExactMultiple` above.
    function test_distributionIsRoughlyFlat() public pure {
        uint256 modulus = 8;
        uint256 samples = 4096;
        uint256[8] memory buckets;
        for (uint256 i; i < samples; ++i) {
            (uint256 v,) = RandomLib.uniformBelow(uint256(keccak256(abi.encode("sample", i))), modulus);
            buckets[v] += 1;
        }
        uint256 expected = samples / modulus;
        for (uint256 i; i < modulus; ++i) {
            assertGt(buckets[i], expected / 2, "bucket starved");
            assertLt(buckets[i], expected * 2, "bucket flooded");
        }
    }
}

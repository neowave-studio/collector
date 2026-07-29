// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

/// @title RandomLib
/// @notice Unbiased reduction of a 256-bit VRF word to `[0, modulus)` (spec §5.3.2, FIX H2-sec/fair).
///
/// A bare `randomWord % modulus` is biased whenever `modulus` does not divide 2^256 — the low
/// residues become slightly more likely. For a pool whose rarest slice is 1/100 of total weight the
/// bias is negligible in absolute terms, but "provably fair" is a cryptographic claim, not an
/// approximate one, so we reject-sample instead.
library RandomLib {
    /// @dev Rejection probability per attempt is < modulus / 2^256. With modulus bounded by
    ///      `PoolLib.MAX_TOTAL_WEIGHT` (2^96) the chance of needing even a second attempt is < 2^-160,
    ///      so 64 attempts can never realistically be exhausted. We still return `ok = false` rather
    ///      than reverting, because this runs inside the VRF callback: a revert there would burn the
    ///      request and strand the user. `ok = false` leaves the draw unrevealed and therefore
    ///      refundable via `refundStuckRip`.
    uint256 private constant MAX_ATTEMPTS = 64;

    /// @param seed A VRF-supplied random word.
    /// @param modulus Exclusive upper bound (the pool's total weight).
    /// @return value Uniformly distributed over `[0, modulus)`.
    /// @return ok False only if `modulus == 0` or every attempt was rejected (see note above).
    function uniformBelow(uint256 seed, uint256 modulus) internal pure returns (uint256 value, bool ok) {
        if (modulus == 0) return (0, false);

        // Accept r in [0, threshold]; that window has `2^256 - (2^256 mod modulus)` values, which is
        // an exact multiple of `modulus`, so `r % modulus` is uniform.
        uint256 threshold;
        unchecked {
            uint256 rem = (type(uint256).max % modulus + 1) % modulus; // == 2^256 mod modulus
            threshold = type(uint256).max - rem;
        }

        uint256 r = seed;
        for (uint256 i; i < MAX_ATTEMPTS; ++i) {
            if (r <= threshold) return (r % modulus, true);
            // Re-expand deterministically from the same VRF word: still unpredictable to everyone,
            // still verifiable by anyone replaying the computation.
            r = uint256(keccak256(abi.encode(seed, i)));
        }
        return (0, false);
    }
}

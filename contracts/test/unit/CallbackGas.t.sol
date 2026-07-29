// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixture} from "../utils/Fixture.sol";
import {GachaMachine} from "../../src/GachaMachine.sol";

/**
 * Measures the VRF callback so `vrfCallbackGasLimit` can be set from data rather than from caution.
 *
 * The limit is not free headroom. Chainlink reserves `maxGasPrice × callbackGasLimit` from the
 * subscription *before* it will accept a request, and each gas lane has its own max price. At 2.5M —
 * the maximum the coordinator allows — Base's 30 gwei lane reserves 0.075 ETH per request, which
 * nobody notices, while Sepolia's 500 gwei lane reserves 1.25 ETH and silently parks every request
 * as "pending, insufficient balance". Same contract, same config, one chain works.
 *
 * Too low is worse than too high, though: a callback that runs out of gas leaves the draw unrevealed.
 * That is recoverable (`refundStuckRip`) but it is a bad outcome, so this measures the real ceiling —
 * MAX_RIPS_PER_TX draws revealed in one callback — and the limit is set above it with margin.
 */
contract CallbackGasTest is Fixture {
    function test_measureCallbackGasAcrossBatchSizes() public {
        uint96 maxRips = gacha.MAX_RIPS_PER_TX();

        uint256 single = _measure(1);
        uint256 full = _measure(maxRips);

        emit log_named_uint("callback gas, 1 rip", single);
        emit log_named_uint("callback gas, MAX_RIPS_PER_TX", full);
        emit log_named_uint("MAX_RIPS_PER_TX", maxRips);

        // Guards the number the deployment config is derived from. If the reveal loop gets more
        // expensive, this fails here rather than as unfulfillable requests on a live chain.
        assertLt(full, 600_000, "full-batch callback exceeds the budget chains.json is sized for");
    }

    /// @dev Rips `n` draws and returns the gas the coordinator's callback actually consumed.
    function _measure(uint96 n) internal returns (uint256) {
        doRip(alice, alicePk, n);
        uint256 requestId = vrf.nextRequestId() - 1;

        uint256[] memory words = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            // Vary the words so different slices are hit; a single repeated value could take an
            // unrepresentatively cheap path through the partition search.
            words[i] = uint256(keccak256(abi.encode("word", i)));
        }

        uint256 before = gasleft();
        vrf.fulfill(requestId, words);
        return before - gasleft();
    }
}

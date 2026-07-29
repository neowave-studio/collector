// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixture} from "../utils/Fixture.sol";
import {GachaMachine} from "../../src/GachaMachine.sol";

/// @notice The "kill the backend and self-settle" end-to-end test (spec §8.2 [MUST], §10 checklist).
///
/// The calldata below was NOT produced by Solidity, viem, or anything else that shares code with the
/// contracts. It came out of `tools/proof-generator/cli.mjs` — a dependency-free file that implements
/// keccak-256 from the Keccak spec and knows nothing about this repository beyond the published pool
/// file:
///
///   $ node cli.mjs settle --pool pool.json --draw 1 --weight 0
///
/// where `pool.json` lists exactly the four cards this fixture commits. If the contract accepts it,
/// then a user with only (a) the on-chain draw, (b) the published pool file, and (c) that one static
/// file can take delivery of their card with no help from us at all. That is the difference between
/// an escape hatch and a paragraph about one.
///
/// If this test ever fails, the offline tool has drifted from the contracts and self-custody is
/// broken — treat it as a release blocker, not a flaky test.
contract OfflineSelfSettleTest is Fixture {
    /// @dev Byte-for-byte output of the offline CLI. Do not regenerate with an on-chain helper.
    bytes internal constant OFFLINE_CALLDATA =
        hex"b6f42b62"
        hex"0000000000000000000000000000000000000000000000000000000000000001"
        hex"0000000000000000000000000000000000000000000000000000000000000040"
        hex"0000000000000000000000000000000000000000000000000000000000000001"
        hex"0000000000000000000000000000000000000000000000000000000000000000"
        hex"0000000000000000000000000000000000000000000000000000000000000050"
        hex"0000000000000000000000000000000000000000000000000000000001c9c380"
        hex"0000000000000000000000000000000000000000000000000000000000000000"
        hex"00000000000000000000000000000000000000000000000000000000000000c0"
        hex"0000000000000000000000000000000000000000000000000000000000000002"
        hex"e2e5f9e03b6a3c4892f7bb79647ae9b438180e682c70c4aab32f491bba9380d0"
        hex"42bb6db550c9193d2a06ef513afc0db5c8090b77b2bc99554944d4e1df001507";

    function test_calldataFromTheOfflineToolSettlesTheDraw() public {
        // A user rips and the VRF lands on weight 0 — the only fact they need from the chain.
        uint256 drawId = doRip(alice, alicePk, 1);
        assertEq(drawId, 1, "the offline calldata was generated for drawId 1");
        vrf.fulfillOne(vrf.nextRequestId() - 1, 0);

        // Now we vanish: pause everything the operator controls.
        vm.startPrank(pauser);
        gacha.pause();
        reserve.pause();
        vm.stopPrank();

        skip(BUYBACK_WINDOW + 1);

        // A completely unrelated address broadcasts the offline tool's raw calldata.
        address stranger = makeAddr("strangerWithNoRoles");
        vm.prank(stranger);
        (bool ok, bytes memory ret) = address(gacha).call(OFFLINE_CALLDATA);

        assertTrue(ok, string.concat("offline calldata rejected: ", _revertReason(ret)));
        assertEq(nft.ownerOf(1), alice, "card must go to the draw's owner, never to the sender");
        assertTrue(gacha.getDraw(drawId).settled);
        assertEq(reserve.reservedLiabilities(address(usdc)), 0, "reservation released even while paused");
    }

    /// @notice The same guarantee for a rip whose randomness never arrives.
    function test_offlineRefundCalldataWorksWhilePaused() public {
        uint256 balanceBefore = usdc.balanceOf(alice); // before the rip charges them
        uint256 drawId = doRip(alice, alicePk, 1);

        vm.prank(pauser);
        gacha.pause();
        skip(RIP_REVEAL_TIMEOUT + 1);

        // `node cli.mjs refund --draw 1`
        bytes memory refundCalldata = hex"7ac5fff8" hex"0000000000000000000000000000000000000000000000000000000000000001";

        vm.prank(makeAddr("anotherStranger"));
        (bool ok, bytes memory ret) = address(gacha).call(refundCalldata);

        assertTrue(ok, string.concat("offline refund calldata rejected: ", _revertReason(ret)));
        assertEq(usdc.balanceOf(alice), balanceBefore, "user made whole: the full escrow came back");
        assertTrue(gacha.getDraw(drawId).settled);
    }

    function _revertReason(bytes memory ret) private pure returns (string memory) {
        if (ret.length < 4) return "no revert data";
        return vm.toString(ret);
    }
}

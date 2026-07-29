// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixture} from "../utils/Fixture.sol";
import {GachaMachine} from "../../src/GachaMachine.sol";
import {PoolLib} from "../../src/libraries/PoolLib.sol";
import {Vault} from "../../src/Vault.sol";
import {ReserveVault} from "../../src/ReserveVault.sol";
import {Roles} from "../../src/access/Roles.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

/// @notice Spec §5.3.2 — the draw lifecycle, its guards, and the escape hatches that make the
///         "if we vanish, you can still settle" claim true.
contract DrawLifecycleTest is Fixture {
    // =============================================================================================
    // Happy path
    // =============================================================================================

    function test_ripEscrowsPaymentAndBooksTheWorstCaseReservation() public {
        uint256 balanceBefore = usdc.balanceOf(alice);
        uint256 reservedBefore = reserve.reservedLiabilities(address(usdc));

        uint256 drawId = doRip(alice, alicePk, 1);

        assertEq(usdc.balanceOf(alice), balanceBefore - PRICE_PER_RIP, "user charged exactly the signed price");
        assertEq(usdc.balanceOf(address(gacha)), PRICE_PER_RIP, "payment escrowed until resolution");
        assertEq(gacha.escrowedFunds(address(usdc)), PRICE_PER_RIP);
        assertEq(
            reserve.reservedLiabilities(address(usdc)) - reservedBefore,
            uint256(800e6), // maxPriceRef × unavailableBps
            "worst-case buyback booked before the user is ever offered one"
        );

        GachaMachine.Draw memory d = gacha.getDraw(drawId);
        assertEq(d.user, alice);
        assertEq(d.packId, PACK);
        assertEq(d.poolVersion, VERSION);
        assertFalse(d.revealed);
        assertEq(gacha.pendingDraws(PACK), 1);
    }

    function test_fullDeliveryPath() public {
        (uint256 drawId, GachaMachine.LeafProof memory proof) = ripAndReveal(alice, alicePk, 0);

        GachaMachine.Draw memory revealed = gacha.getDraw(drawId);
        assertTrue(revealed.revealed);
        assertEq(revealed.winningWeight, 0);

        skip(BUYBACK_WINDOW + 1);
        gacha.settle(drawId, proof);

        assertEq(nft.ownerOf(proof.tokenId), alice, "card delivered to the draw's user");
        assertFalse(vault.isHeld(proof.tokenId));
        assertEq(reserve.reservedLiabilities(address(usdc)), 0, "reservation released on delivery");
        assertEq(gacha.escrowedFunds(address(usdc)), 0);
        assertEq(gacha.pendingDraws(PACK), 0);
        assertTrue(gacha.getDraw(drawId).settled);
    }

    function test_revenueSplitsBetweenReserveAndTreasuryOnFlush() public {
        (uint256 drawId, GachaMachine.LeafProof memory proof) = ripAndReveal(alice, alicePk, 0);
        skip(BUYBACK_WINDOW + 1);
        gacha.settle(drawId, proof);

        uint256 expectedReserve = PRICE_PER_RIP * RESERVE_BPS / 10_000;
        assertEq(gacha.pendingReserveRevenue(address(usdc)), expectedReserve);
        assertEq(gacha.pendingTreasuryRevenue(address(usdc)), PRICE_PER_RIP - expectedReserve);

        uint256 reserveBalanceBefore = usdc.balanceOf(address(reserve));
        gacha.flushRevenue(address(usdc));

        assertEq(usdc.balanceOf(treasury), PRICE_PER_RIP - expectedReserve);
        assertEq(usdc.balanceOf(address(reserve)) - reserveBalanceBefore, expectedReserve);
        assertEq(usdc.balanceOf(address(gacha)), 0, "nothing left stranded in the machine");
    }

    function test_multiRipCreatesIndependentDraws() public {
        uint256 first = doRip(alice, alicePk, 3);
        uint256 requestId = vrf.nextRequestId() - 1;

        uint256[] memory words = new uint256[](3);
        words[0] = 0; // leaf 0
        words[1] = 80; // leaf 1
        words[2] = 99; // leaf 3
        vrf.fulfill(requestId, words);

        assertEq(gacha.getDraw(first).winningWeight, 0);
        assertEq(gacha.getDraw(first + 1).winningWeight, 80);
        assertEq(gacha.getDraw(first + 2).winningWeight, 99);
        assertEq(gacha.pendingDraws(PACK), 3);
        assertEq(reserve.reservedLiabilities(address(usdc)), 3 * 800e6);
    }

    // =============================================================================================
    // Purchase authorization
    // =============================================================================================

    function test_ripRevertsWhenTheSignedVersionIsNoLongerActive() public {
        GachaMachine.PurchaseAuth memory auth = purchaseAuth(alice, 1);
        bytes memory sig = signPurchase(alicePk, auth);

        // Operator schedules and activates a different version between signing and submission.
        _commitSecondVersion();
        _activate(PACK, 2);

        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(GachaMachine.PoolVersionMismatch.selector, VERSION, 2));
        gacha.rip(auth, sig, emptyPermit());
    }

    function test_activationCannotTakeEffectInTheSameBlock() public {
        _commitSecondVersion();
        // Evaluate every external call BEFORE the prank: an argument-position call would consume it.
        uint64 sameBlock = uint64(block.number);
        uint256 minimum = block.number + gacha.minActivationDelayBlocks();
        bytes memory expected =
            abi.encodeWithSelector(GachaMachine.ActivationTooSoon.selector, sameBlock, minimum);

        vm.prank(poolAuthor);
        vm.expectRevert(expected);
        gacha.setActivePoolVersion(PACK, 2, sameBlock);
    }

    function test_scheduledVersionOnlyBindsFromItsAnnouncedBlock() public {
        _commitSecondVersion();
        uint64 from = uint64(block.number + 50);
        vm.prank(poolAuthor);
        gacha.setActivePoolVersion(PACK, 2, from);

        assertEq(gacha.activePoolVersion(PACK), VERSION, "old odds still in force before the announced block");
        vm.roll(from);
        assertEq(gacha.activePoolVersion(PACK), 2);
    }

    function test_purchaseSignatureCannotBeReplayed() public {
        GachaMachine.PurchaseAuth memory auth = purchaseAuth(alice, 1);
        bytes memory sig = signPurchase(alicePk, auth);

        vm.prank(relayer);
        gacha.rip(auth, sig, emptyPermit());

        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(GachaMachine.InvalidNonce.selector, 0, 1));
        gacha.rip(auth, sig, emptyPermit());
    }

    function test_expiredPurchaseAuthIsRejected() public {
        GachaMachine.PurchaseAuth memory auth = purchaseAuth(alice, 1);
        bytes memory sig = signPurchase(alicePk, auth);
        skip(2 hours);

        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(GachaMachine.SignatureExpired.selector, auth.deadline));
        gacha.rip(auth, sig, emptyPermit());
    }

    function test_relayerCannotOverchargeBeyondTheSignedAmount() public {
        GachaMachine.PurchaseAuth memory auth = purchaseAuth(alice, 1);
        bytes memory sig = signPurchase(alicePk, auth);
        auth.amountPerRip = PRICE_PER_RIP * 10; // tampered after signing

        vm.prank(relayer);
        vm.expectRevert(GachaMachine.TermsMismatch.selector);
        gacha.rip(auth, sig, emptyPermit());
    }

    function test_signatureFromSomebodyElseIsRejected() public {
        GachaMachine.PurchaseAuth memory auth = purchaseAuth(alice, 1);
        bytes memory sig = signPurchase(bobPk, auth);

        vm.prank(relayer);
        vm.expectRevert(GachaMachine.InvalidSignature.selector);
        gacha.rip(auth, sig, emptyPermit());
    }

    /// @notice The relayer gate is what makes the §12 geofence/age check enforceable: a user cannot
    ///         route around the compliance decision by calling the contract directly.
    function test_onlyTheRelayerMaySubmitARip() public {
        GachaMachine.PurchaseAuth memory auth = purchaseAuth(alice, 1);
        bytes memory sig = signPurchase(alicePk, auth);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, alice, Roles.TRUSTED_RELAYER_ROLE
            )
        );
        gacha.rip(auth, sig, emptyPermit());
    }

    function test_ripRevertsWhenTheReserveCannotBackTheWorstCase() public {
        // Drain the reserve down to less than one rip's worst case.
        uint256 drain = usdc.balanceOf(address(reserve)) - 100e6;
        vm.prank(address(timelock));
        reserve.withdrawSurplus(address(usdc), drain, treasurer);

        GachaMachine.PurchaseAuth memory auth = purchaseAuth(alice, 1);
        bytes memory sig = signPurchase(alicePk, auth);
        vm.prank(relayer);
        vm.expectRevert(
            abi.encodeWithSelector(ReserveVault.InsufficientReserve.selector, address(usdc), 100e6, 800e6)
        );
        gacha.rip(auth, sig, emptyPermit());
    }

    function test_ripRevertsOncePoolIsTooDepleted() public {
        _settleOne(0);
        _settleOne(1);
        _settleOne(2);
        // 3 of 4 cards gone is past the 50% staleness ceiling: the published odds no longer describe
        // what is deliverable, so no further rip may be sold until a new version is committed.
        GachaMachine.PurchaseAuth memory auth = purchaseAuth(alice, 1);
        bytes memory sig = signPurchase(alicePk, auth);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(GachaMachine.PoolStale.selector, uint32(3), uint32(4)));
        gacha.rip(auth, sig, emptyPermit());
    }

    // =============================================================================================
    // Settlement guards
    // =============================================================================================

    function test_cannotSettleBeforeReveal() public {
        uint256 drawId = doRip(alice, alicePk, 1);
        GachaMachine.LeafProof memory proof = proofForIndex(PACK, VERSION, 0);

        // The v1.0 hole: with winningWeight defaulting to 0, an unrevealed draw would have matched
        // leaf 0 and handed out the floor card for free.
        vm.expectRevert(abi.encodeWithSelector(GachaMachine.DrawNotRevealed.selector, drawId));
        gacha.settle(drawId, proof);
    }

    function test_cannotSettleTwice() public {
        (uint256 drawId, GachaMachine.LeafProof memory proof) = ripAndReveal(alice, alicePk, 0);
        skip(BUYBACK_WINDOW + 1);
        gacha.settle(drawId, proof);

        vm.expectRevert(abi.encodeWithSelector(GachaMachine.DrawAlreadySettled.selector, drawId));
        gacha.settle(drawId, proof);
    }

    function test_cannotDeliverACardWhoseSliceDoesNotContainTheWinningWeight() public {
        (uint256 drawId,) = ripAndReveal(alice, alicePk, 0); // weight 0 → leaf 0
        GachaMachine.LeafProof memory wrong = proofForIndex(PACK, VERSION, 3); // the 800 USDC card

        skip(BUYBACK_WINDOW + 1);
        vm.expectRevert(
            abi.encodeWithSelector(GachaMachine.WeightOutsideSlice.selector, 0, wrong.cumBefore, wrong.weight)
        );
        gacha.settle(drawId, wrong);
    }

    function test_cannotForgeALeafForACardThatIsNotInTheTree() public {
        (uint256 drawId, GachaMachine.LeafProof memory proof) = ripAndReveal(alice, alicePk, 0);
        proof.tokenId = 4; // keep the valid slice + proof, swap the card

        skip(BUYBACK_WINDOW + 1);
        vm.expectRevert(GachaMachine.BadMerkleProof.selector);
        gacha.settle(drawId, proof);
    }

    function test_proofFromAnotherPoolVersionIsRejected() public {
        (uint256 drawId,) = ripAndReveal(alice, alicePk, 0);
        _commitSecondVersion();
        GachaMachine.LeafProof memory otherVersion = proofForIndex(PACK, 2, 0);

        skip(BUYBACK_WINDOW + 1);
        vm.expectRevert(GachaMachine.BadMerkleProof.selector);
        gacha.settle(drawId, otherVersion);
    }

    function test_thirdPartyCannotForceDeliveryDuringTheBuybackWindow() public {
        (uint256 drawId, GachaMachine.LeafProof memory proof) = ripAndReveal(alice, alicePk, 0);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(GachaMachine.NotDrawUser.selector, drawId));
        gacha.settle(drawId, proof);

        // The user may always take their own card immediately.
        vm.prank(alice);
        gacha.settle(drawId, proof);
        assertEq(nft.ownerOf(proof.tokenId), alice);
    }

    // =============================================================================================
    // Escape hatches — the self-custody guarantees
    // =============================================================================================

    function test_claimAfterTimeoutWorksWhileTheSystemIsPaused() public {
        (uint256 drawId, GachaMachine.LeafProof memory proof) = ripAndReveal(alice, alicePk, 2);

        vm.prank(pauser);
        gacha.pause();

        skip(BUYBACK_WINDOW + 1);

        vm.expectRevert(PausableUpgradeable.EnforcedPause.selector);
        gacha.settle(drawId, proof);

        // A stranger can push the delivery — the contract decides the card, not the caller.
        vm.prank(bob);
        gacha.claimAfterTimeout(drawId, proof);
        assertEq(nft.ownerOf(proof.tokenId), alice, "paused system still delivered to the right user");
    }

    function test_claimAfterTimeoutIsBlockedWhileTheUserStillHasTheBuybackOption() public {
        (uint256 drawId, GachaMachine.LeafProof memory proof) = ripAndReveal(alice, alicePk, 0);
        vm.expectRevert(abi.encodeWithSelector(GachaMachine.BuybackWindowOpen.selector, drawId));
        gacha.claimAfterTimeout(drawId, proof);
    }

    function test_refundStuckRipWhenVRFNeverAnswers() public {
        uint256 balanceBefore = usdc.balanceOf(alice);
        uint256 drawId = doRip(alice, alicePk, 1);

        vm.expectRevert(abi.encodeWithSelector(GachaMachine.RevealNotTimedOut.selector, drawId));
        gacha.refundStuckRip(drawId);

        skip(RIP_REVEAL_TIMEOUT + 1);
        vm.prank(pauser);
        gacha.pause(); // must work even paused

        vm.prank(bob); // permissionless: funds go to the draw's user regardless of who calls
        gacha.refundStuckRip(drawId);

        assertEq(usdc.balanceOf(alice), balanceBefore, "user made whole");
        assertEq(reserve.reservedLiabilities(address(usdc)), 0, "reservation released");
        assertEq(gacha.pendingDraws(PACK), 0);
    }

    function test_cannotRefundOnceRevealed() public {
        (uint256 drawId,) = ripAndReveal(alice, alicePk, 0);
        skip(RIP_REVEAL_TIMEOUT + 1);
        vm.expectRevert(abi.encodeWithSelector(GachaMachine.DrawAlreadyRevealed.selector, drawId));
        gacha.refundStuckRip(drawId);
    }

    /// @notice Two draws can land on the same card. The second user must never be stranded.
    function test_claimUnavailableCompensatesWhenTheCardIsAlreadyGone() public {
        (uint256 firstDraw, GachaMachine.LeafProof memory proof) = ripAndReveal(alice, alicePk, 3);
        vm.prank(alice);
        gacha.settle(firstDraw, proof); // alice takes the 800 USDC card

        (uint256 secondDraw, GachaMachine.LeafProof memory sameCard) = ripAndReveal(bob, bobPk, 3);
        assertEq(sameCard.tokenId, proof.tokenId);

        uint256 balanceBefore = usdc.balanceOf(bob);
        gacha.claimUnavailable(secondDraw, sameCard);

        assertEq(
            usdc.balanceOf(bob) - balanceBefore,
            uint256(800e6) * UNAVAILABLE_BPS / 10_000,
            "compensated at the card's committed reference value"
        );
        assertEq(reserve.reservedLiabilities(address(usdc)), 0);
        assertTrue(gacha.getDraw(secondDraw).settled);
    }

    function test_claimUnavailableRejectedWhileTheCardIsStillDeliverable() public {
        (uint256 drawId, GachaMachine.LeafProof memory proof) = ripAndReveal(alice, alicePk, 0);
        vm.expectRevert(abi.encodeWithSelector(GachaMachine.CardStillAvailable.selector, proof.tokenId));
        gacha.claimUnavailable(drawId, proof);
    }

    // =============================================================================================
    // VRF callback
    // =============================================================================================

    function test_onlyTheCoordinatorMayDeliverRandomness() public {
        doRip(alice, alicePk, 1);
        uint256 requestId = vrf.nextRequestId() - 1;
        uint256[] memory words = new uint256[](1);
        words[0] = 99;

        vm.prank(relayer);
        vm.expectRevert();
        gacha.rawFulfillRandomWords(requestId, words);
    }

    function test_revealIsIdempotent() public {
        uint256 drawId = doRip(alice, alicePk, 1);
        uint256 requestId = vrf.nextRequestId() - 1;
        vrf.fulfillOne(requestId, 0);
        assertEq(gacha.getDraw(drawId).winningWeight, 0);

        // A duplicate delivery must not be able to re-roll the outcome.
        vm.expectRevert(abi.encodeWithSelector(GachaMachine.UnknownVRFRequest.selector, requestId));
        vrf.fulfillOne(requestId, 99);
        assertEq(gacha.getDraw(drawId).winningWeight, 0, "outcome unchanged");
    }

    function test_vrfRequestAsksForOneWordPerRip() public {
        doRip(alice, alicePk, 4);
        uint256 requestId = vrf.nextRequestId() - 1;
        assertEq(vrf.numWordsOf(requestId), 4);
        assertEq(vrf.keyHashOf(requestId), keccak256("gaslane"));
    }

    function test_ripCountIsBounded() public {
        GachaMachine.PurchaseAuth memory auth = purchaseAuth(alice, 11);
        bytes memory sig = signPurchase(alicePk, auth);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(GachaMachine.InvalidRipCount.selector, uint96(11)));
        gacha.rip(auth, sig, emptyPermit());
    }

    // =============================================================================================
    // Inventory interaction
    // =============================================================================================

    function test_sweepIsBlockedWhileThePackHasLiveDraws() public {
        doRip(alice, alicePk, 1);
        vm.prank(inventoryAdmin);
        vm.expectRevert(abi.encodeWithSelector(Vault.PackHasPendingDraws.selector, PACK, uint256(1)));
        vault.sweepTo(inventoryAdmin, 1);
    }

    function test_sweepAllowedOnceEveryDrawResolved() public {
        uint256 drawId = doRip(alice, alicePk, 1);
        skip(RIP_REVEAL_TIMEOUT + 1);
        gacha.refundStuckRip(drawId);

        vm.prank(inventoryAdmin);
        vault.sweepTo(inventoryAdmin, 1);
        assertEq(nft.ownerOf(1), inventoryAdmin);
    }

    // =============================================================================================
    // Helpers
    // =============================================================================================

    function _settleOne(uint256 leafIndex) internal {
        (uint256 drawId, GachaMachine.LeafProof memory proof) = ripAndReveal(alice, alicePk, leafIndex);
        vm.prank(alice);
        gacha.settle(drawId, proof);
    }

    function _commitSecondVersion() internal {
        PoolLib.Leaf[] memory leaves = defaultLeaves();
        vm.prank(poolAuthor);
        gacha.commitPool(PACK, 2, defaultPoolParams(), leaves);
    }

}

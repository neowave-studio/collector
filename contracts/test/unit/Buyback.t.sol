// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixture} from "../utils/Fixture.sol";
import {GachaMachine} from "../../src/GachaMachine.sol";
import {ReserveVault} from "../../src/ReserveVault.sol";
import {Roles} from "../../src/access/Roles.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

/// @notice Spec §5.3.3 — instant sell-back. The point of every test here is that the payout is bounded
///         by things committed BEFORE the draw, not by anything the oracle asserts afterwards.
contract BuybackTest is Fixture {
    function _auth(uint256 drawId, address user, uint256 payout)
        internal
        view
        returns (GachaMachine.BuybackAuth memory)
    {
        return GachaMachine.BuybackAuth({
            drawId: drawId,
            payToken: address(usdc),
            payout: payout,
            nonce: gacha.nonces(user),
            deadline: uint48(block.timestamp + 30 minutes)
        });
    }

    function _submit(
        uint256 drawId,
        GachaMachine.BuybackAuth memory auth,
        uint256 userPk,
        uint256 signerPk,
        GachaMachine.LeafProof memory proof
    ) internal {
        bytes memory userSig = signBuyback(userPk, gacha.BUYBACK_USER_TYPEHASH(), auth);
        bytes memory oracleSig = signBuyback(signerPk, gacha.BUYBACK_AUTH_TYPEHASH(), auth);
        vm.prank(buybackRelayer);
        gacha.settleBuyback(drawId, auth, userSig, oracleSig, proof);
    }

    function test_happyPathPaysFromTheReserveAndKeepsTheCard() public {
        (uint256 drawId, GachaMachine.LeafProof memory proof) = ripAndReveal(alice, alicePk, 3); // 800 USDC card
        uint256 payout = uint256(800e6) * BUYBACK_BPS / 10_000; // 680 USDC
        uint256 before = usdc.balanceOf(alice);

        _submit(drawId, _auth(drawId, alice, payout), alicePk, oraclePk, proof);

        assertEq(usdc.balanceOf(alice) - before, payout);
        assertTrue(vault.isHeld(proof.tokenId), "card returns to inventory, it is not delivered");
        assertEq(reserve.reservedLiabilities(address(usdc)), 0, "reservation fully released");
        assertTrue(gacha.getDraw(drawId).settled);
    }

    /// @notice The v1.0 hole: payout was whatever the oracle signed. Now the ceiling comes from the
    ///         drawn card's own immutable `priceRef` in the draw's own pool version.
    function test_payoutIsHardCappedByTheDrawnCardsCommittedPriceRef() public {
        (uint256 drawId, GachaMachine.LeafProof memory proof) = ripAndReveal(alice, alicePk, 0); // 30 USDC card
        uint256 cap = uint256(30e6) * BUYBACK_BPS / 10_000;

        GachaMachine.BuybackAuth memory auth = _auth(drawId, alice, cap + 1);
        bytes memory userSig = signBuyback(alicePk, gacha.BUYBACK_USER_TYPEHASH(), auth);
        bytes memory oracleSig = signBuyback(oraclePk, gacha.BUYBACK_AUTH_TYPEHASH(), auth);

        vm.prank(buybackRelayer);
        vm.expectRevert(abi.encodeWithSelector(GachaMachine.PayoutExceedsCap.selector, cap + 1, cap));
        gacha.settleBuyback(drawId, auth, userSig, oracleSig, proof);
    }

    /// @notice A hostile oracle cannot substitute an expensive card's proof for a cheap draw: the
    ///         slice check ties the proof to the VRF weight.
    function test_oracleCannotSwapInAMoreValuableCardsProof() public {
        (uint256 drawId,) = ripAndReveal(alice, alicePk, 0); // weight 0 → the 30 USDC card
        GachaMachine.LeafProof memory expensive = proofForIndex(PACK, VERSION, 3);

        GachaMachine.BuybackAuth memory auth = _auth(drawId, alice, 680e6);
        bytes memory userSig = signBuyback(alicePk, gacha.BUYBACK_USER_TYPEHASH(), auth);
        bytes memory oracleSig = signBuyback(oraclePk, gacha.BUYBACK_AUTH_TYPEHASH(), auth);

        vm.prank(buybackRelayer);
        vm.expectRevert(
            abi.encodeWithSelector(
                GachaMachine.WeightOutsideSlice.selector, 0, expensive.cumBefore, expensive.weight
            )
        );
        gacha.settleBuyback(drawId, auth, userSig, oracleSig, expensive);
    }

    function test_requiresTheUsersOwnSignature() public {
        (uint256 drawId, GachaMachine.LeafProof memory proof) = ripAndReveal(alice, alicePk, 0);
        GachaMachine.BuybackAuth memory auth = _auth(drawId, alice, 1e6);

        bytes memory notAlice = signBuyback(bobPk, gacha.BUYBACK_USER_TYPEHASH(), auth);
        bytes memory oracleSig = signBuyback(oraclePk, gacha.BUYBACK_AUTH_TYPEHASH(), auth);

        vm.prank(buybackRelayer);
        vm.expectRevert(GachaMachine.InvalidSignature.selector);
        gacha.settleBuyback(drawId, auth, notAlice, oracleSig, proof);
    }

    function test_requiresASignatureFromAnAddressHoldingTheOracleRole() public {
        (uint256 drawId, GachaMachine.LeafProof memory proof) = ripAndReveal(alice, alicePk, 0);
        GachaMachine.BuybackAuth memory auth = _auth(drawId, alice, 1e6);

        bytes memory userSig = signBuyback(alicePk, gacha.BUYBACK_USER_TYPEHASH(), auth);
        bytes memory notOracle = signBuyback(bobPk, gacha.BUYBACK_AUTH_TYPEHASH(), auth);

        vm.prank(buybackRelayer);
        vm.expectRevert(GachaMachine.InvalidSignature.selector);
        gacha.settleBuyback(drawId, auth, userSig, notOracle, proof);
    }

    /// @notice The user's and oracle's payloads use different typehashes over identical fields, so one
    ///         party's signature can never stand in for the other's.
    function test_userSignatureCannotBeReusedAsTheOracleSignature() public {
        (uint256 drawId, GachaMachine.LeafProof memory proof) = ripAndReveal(alice, alicePk, 0);
        GachaMachine.BuybackAuth memory auth = _auth(drawId, alice, 1e6);

        // Sign with the ORACLE key but under the user typehash, then present it as the oracle sig.
        bytes memory oracleUnderUserTypehash = signBuyback(oraclePk, gacha.BUYBACK_USER_TYPEHASH(), auth);
        bytes memory userSig = signBuyback(alicePk, gacha.BUYBACK_USER_TYPEHASH(), auth);

        vm.prank(buybackRelayer);
        vm.expectRevert(GachaMachine.InvalidSignature.selector);
        gacha.settleBuyback(drawId, auth, userSig, oracleUnderUserTypehash, proof);
    }

    function test_onlyTheBuybackRelayerMaySubmit() public {
        (uint256 drawId, GachaMachine.LeafProof memory proof) = ripAndReveal(alice, alicePk, 0);
        GachaMachine.BuybackAuth memory auth = _auth(drawId, alice, 1e6);
        bytes memory userSig = signBuyback(alicePk, gacha.BUYBACK_USER_TYPEHASH(), auth);
        bytes memory oracleSig = signBuyback(oraclePk, gacha.BUYBACK_AUTH_TYPEHASH(), auth);

        vm.prank(relayer); // the rip relayer, not the buyback relayer
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, relayer, Roles.TRUSTED_BUYBACK_ROLE
            )
        );
        gacha.settleBuyback(drawId, auth, userSig, oracleSig, proof);
    }

    function test_windowLapsesAndTheOptionExpires() public {
        (uint256 drawId, GachaMachine.LeafProof memory proof) = ripAndReveal(alice, alicePk, 0);
        skip(BUYBACK_WINDOW + 1);

        GachaMachine.BuybackAuth memory auth = _auth(drawId, alice, 1e6);
        bytes memory userSig = signBuyback(alicePk, gacha.BUYBACK_USER_TYPEHASH(), auth);
        bytes memory oracleSig = signBuyback(oraclePk, gacha.BUYBACK_AUTH_TYPEHASH(), auth);

        vm.prank(buybackRelayer);
        vm.expectRevert(abi.encodeWithSelector(GachaMachine.BuybackWindowClosed.selector, drawId));
        gacha.settleBuyback(drawId, auth, userSig, oracleSig, proof);

        // and the user still has their card
        gacha.settle(drawId, proof);
        assertEq(nft.ownerOf(proof.tokenId), alice);
    }

    function test_expiredAuthIsRejected() public {
        (uint256 drawId, GachaMachine.LeafProof memory proof) = ripAndReveal(alice, alicePk, 0);
        GachaMachine.BuybackAuth memory auth = _auth(drawId, alice, 1e6);
        auth.deadline = uint48(block.timestamp - 1);

        bytes memory userSig = signBuyback(alicePk, gacha.BUYBACK_USER_TYPEHASH(), auth);
        bytes memory oracleSig = signBuyback(oraclePk, gacha.BUYBACK_AUTH_TYPEHASH(), auth);

        vm.prank(buybackRelayer);
        vm.expectRevert(abi.encodeWithSelector(GachaMachine.SignatureExpired.selector, auth.deadline));
        gacha.settleBuyback(drawId, auth, userSig, oracleSig, proof);
    }

    function test_authForOneDrawCannotSettleAnother() public {
        (uint256 drawA,) = ripAndReveal(alice, alicePk, 0);
        (uint256 drawB, GachaMachine.LeafProof memory proofB) = ripAndReveal(bob, bobPk, 1);

        GachaMachine.BuybackAuth memory auth = _auth(drawA, bob, 1e6);
        bytes memory userSig = signBuyback(bobPk, gacha.BUYBACK_USER_TYPEHASH(), auth);
        bytes memory oracleSig = signBuyback(oraclePk, gacha.BUYBACK_AUTH_TYPEHASH(), auth);

        vm.prank(buybackRelayer);
        vm.expectRevert(GachaMachine.TermsMismatch.selector);
        gacha.settleBuyback(drawB, auth, userSig, oracleSig, proofB);
    }

    /// @notice Spec §9 chargeback defence: a fiat-funded user's cash-out can be time-boxed while the
    ///         payment is still reversible — but their CARD is never held hostage.
    function test_riskHoldbackBlocksCashOutButNotDelivery() public {
        (uint256 drawId, GachaMachine.LeafProof memory proof) = ripAndReveal(alice, alicePk, 0);

        uint64 until = uint64(block.timestamp + 30 days);
        vm.prank(riskAdmin);
        gacha.setBuybackLock(alice, until);

        GachaMachine.BuybackAuth memory auth = _auth(drawId, alice, 1e6);
        bytes memory userSig = signBuyback(alicePk, gacha.BUYBACK_USER_TYPEHASH(), auth);
        bytes memory oracleSig = signBuyback(oraclePk, gacha.BUYBACK_AUTH_TYPEHASH(), auth);

        vm.prank(buybackRelayer);
        vm.expectRevert(abi.encodeWithSelector(GachaMachine.BuybackLocked.selector, alice, until));
        gacha.settleBuyback(drawId, auth, userSig, oracleSig, proof);

        vm.prank(alice);
        gacha.settle(drawId, proof);
        assertEq(nft.ownerOf(proof.tokenId), alice, "delivery is never blocked by a risk holdback");
    }

    /// @notice Even with the oracle key AND the buyback key compromised, the per-epoch ceiling caps
    ///         the bleed before the pause can land (spec §8.8).
    function test_perEpochOutflowCeilingStopsADrain() public {
        vm.prank(address(timelock));
        reserve.setMaxBuybackOutflow(address(usdc), 700e6); // room for exactly one 680 USDC buyback

        (uint256 first, GachaMachine.LeafProof memory p1) = ripAndReveal(alice, alicePk, 3);
        _submit(first, _auth(first, alice, 680e6), alicePk, oraclePk, p1);

        (uint256 second, GachaMachine.LeafProof memory p2) = ripAndReveal(bob, bobPk, 3);
        GachaMachine.BuybackAuth memory auth = _auth(second, bob, 680e6);
        bytes memory userSig = signBuyback(bobPk, gacha.BUYBACK_USER_TYPEHASH(), auth);
        bytes memory oracleSig = signBuyback(oraclePk, gacha.BUYBACK_AUTH_TYPEHASH(), auth);

        vm.prank(buybackRelayer);
        vm.expectRevert(
            abi.encodeWithSelector(ReserveVault.OutflowCapExceeded.selector, address(usdc), 680e6, 20e6)
        );
        gacha.settleBuyback(second, auth, userSig, oracleSig, p2);
    }

    function test_buybackCannotRunOnASettledDraw() public {
        (uint256 drawId, GachaMachine.LeafProof memory proof) = ripAndReveal(alice, alicePk, 0);
        vm.prank(alice);
        gacha.settle(drawId, proof);

        GachaMachine.BuybackAuth memory auth = _auth(drawId, alice, 1e6);
        bytes memory userSig = signBuyback(alicePk, gacha.BUYBACK_USER_TYPEHASH(), auth);
        bytes memory oracleSig = signBuyback(oraclePk, gacha.BUYBACK_AUTH_TYPEHASH(), auth);

        vm.prank(buybackRelayer);
        vm.expectRevert(abi.encodeWithSelector(GachaMachine.DrawAlreadySettled.selector, drawId));
        gacha.settleBuyback(drawId, auth, userSig, oracleSig, proof);
    }
}

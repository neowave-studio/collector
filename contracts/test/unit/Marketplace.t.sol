// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixture} from "../utils/Fixture.sol";
import {Marketplace} from "../../src/Marketplace.sol";
import {GachaMachine} from "../../src/GachaMachine.sol";
import {Roles} from "../../src/access/Roles.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

/// @notice Spec §5.6 / FIX M2-sec — order replay, expiry and the fee/royalty split.
contract MarketplaceTest is Fixture {
    uint256 internal constant LIST_PRICE = 1_000e6;

    /// @dev Gives `alice` a real card by running a full rip → reveal → settle.
    function _giveAliceACard() internal returns (uint256 tokenId) {
        (uint256 drawId, GachaMachine.LeafProof memory proof) = ripAndReveal(alice, alicePk, 0);
        vm.prank(alice);
        gacha.settle(drawId, proof);
        tokenId = proof.tokenId;
        vm.prank(alice);
        nft.setApprovalForAll(address(market), true);
    }

    function _order(address maker, uint256 tokenId, uint256 nonce) internal view returns (Marketplace.Order memory) {
        return Marketplace.Order({
            maker: maker,
            tokenId: tokenId,
            price: LIST_PRICE,
            payToken: address(usdc),
            nonce: nonce,
            expiry: uint48(block.timestamp + 1 days)
        });
    }

    function _signListing(uint256 pk, Marketplace.Order memory order) internal view returns (bytes memory) {
        return _sign(pk, market.hashListing(order));
    }

    function _signOffer(uint256 pk, Marketplace.Order memory order) internal view returns (bytes memory) {
        return _sign(pk, market.hashOffer(order));
    }

    function test_buyPaysSellerFeeAndRoyaltyExactly() public {
        uint256 tokenId = _giveAliceACard();
        Marketplace.Order memory order = _order(alice, tokenId, 1);
        bytes memory sig = _signListing(alicePk, order);

        uint256 sellerBefore = usdc.balanceOf(alice);
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        uint256 royaltyBefore = usdc.balanceOf(royaltyReceiver);

        vm.prank(bob);
        market.buy(order, sig, emptyPermit());

        uint256 fee = LIST_PRICE * 250 / 10_000; // 2.5% platform
        uint256 royalty = LIST_PRICE * 500 / 10_000; // 5% EIP-2981

        assertEq(nft.ownerOf(tokenId), bob);
        assertEq(usdc.balanceOf(treasury) - treasuryBefore, fee);
        assertEq(usdc.balanceOf(royaltyReceiver) - royaltyBefore, royalty);
        assertEq(usdc.balanceOf(alice) - sellerBefore, LIST_PRICE - fee - royalty);
        assertEq(usdc.balanceOf(address(market)), 0, "nothing retained by the marketplace");
    }

    function test_acceptOfferMovesTheCardAndTheMoney() public {
        uint256 tokenId = _giveAliceACard();
        Marketplace.Order memory order = _order(bob, tokenId, 1);
        bytes memory sig = _signOffer(bobPk, order);

        vm.prank(alice);
        market.acceptOffer(order, sig, emptyPermit());

        assertEq(nft.ownerOf(tokenId), bob);
    }

    /// @notice Listings and offers share field layout, so they MUST use different typehashes.
    function test_aListingSignatureCannotBeReplayedAsAnOffer() public {
        uint256 tokenId = _giveAliceACard();
        Marketplace.Order memory order = _order(alice, tokenId, 1);
        bytes memory listingSig = _signListing(alicePk, order);

        vm.prank(bob);
        vm.expectRevert(Marketplace.InvalidSignature.selector);
        market.acceptOffer(order, listingSig, emptyPermit());
    }

    function test_orderNonceIsSingleUse() public {
        uint256 tokenId = _giveAliceACard();
        Marketplace.Order memory order = _order(alice, tokenId, 1);
        bytes memory sig = _signListing(alicePk, order);

        vm.prank(bob);
        market.buy(order, sig, emptyPermit());

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Marketplace.NonceAlreadyUsed.selector, alice, uint256(1)));
        market.buy(order, sig, emptyPermit());
    }

    function test_expiredOrderIsRejected() public {
        uint256 tokenId = _giveAliceACard();
        Marketplace.Order memory order = _order(alice, tokenId, 1);
        bytes memory sig = _signListing(alicePk, order);
        skip(2 days);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Marketplace.OrderExpired.selector, order.expiry));
        market.buy(order, sig, emptyPermit());
    }

    function test_bumpMinNonceKillsEveryOutstandingOrder() public {
        uint256 tokenId = _giveAliceACard();
        Marketplace.Order memory order = _order(alice, tokenId, 5);
        bytes memory sig = _signListing(alicePk, order);

        vm.prank(alice);
        market.bumpMinNonce(10);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Marketplace.NonceBelowMinimum.selector, uint256(5), uint256(10)));
        market.buy(order, sig, emptyPermit());
    }

    function test_cancelKillsASingleOrder() public {
        uint256 tokenId = _giveAliceACard();
        Marketplace.Order memory order = _order(alice, tokenId, 3);
        bytes memory sig = _signListing(alicePk, order);

        vm.prank(alice);
        market.cancel(order, true);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Marketplace.NonceAlreadyUsed.selector, alice, uint256(3)));
        market.buy(order, sig, emptyPermit());
    }

    function test_cannotBuyFromAMakerWhoNoLongerOwnsTheCard() public {
        uint256 tokenId = _giveAliceACard();
        Marketplace.Order memory order = _order(alice, tokenId, 1);
        bytes memory sig = _signListing(alicePk, order);

        vm.prank(alice);
        nft.transferFrom(alice, bob, tokenId);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Marketplace.MakerIsNotOwner.selector, tokenId, alice));
        market.buy(order, sig, emptyPermit());
    }

    function test_feeIsCappedInCode() public {
        vm.prank(feeAdmin);
        vm.expectRevert(abi.encodeWithSelector(Marketplace.FeeTooHigh.selector, uint16(1001)));
        market.setFeeBps(1001);

        vm.prank(feeAdmin);
        market.setFeeBps(1000); // exactly MAX_FEE_BPS is allowed
        assertEq(market.feeBps(), 1000);
    }

    function test_feeRecipientChangeIsTimelockGated() public {
        vm.prank(feeAdmin);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, feeAdmin, Roles.DEFAULT_ADMIN_ROLE
            )
        );
        market.setFeeRecipient(feeAdmin);

        vm.prank(address(timelock));
        market.setFeeRecipient(feeAdmin);
        assertEq(market.feeRecipient(), feeAdmin);
    }

    /// @notice Even at the maximum platform fee, the royalty is clamped so the seller can never be
    ///         paid a negative amount (spec §5.6 `fee + royalty <= price`).
    function test_maximumFeePlusRoyaltyStillLeavesTheSellerWhole() public {
        vm.prank(feeAdmin);
        market.setFeeBps(1000);

        uint256 tokenId = _giveAliceACard();
        Marketplace.Order memory order = _order(alice, tokenId, 1);
        bytes memory sig = _signListing(alicePk, order);

        uint256 sellerBefore = usdc.balanceOf(alice);
        vm.prank(bob);
        market.buy(order, sig, emptyPermit());

        uint256 fee = LIST_PRICE * 1000 / 10_000;
        uint256 royalty = LIST_PRICE * 500 / 10_000;
        assertEq(usdc.balanceOf(alice) - sellerBefore, LIST_PRICE - fee - royalty);
    }

    function test_selfTradeIsRejected() public {
        uint256 tokenId = _giveAliceACard();
        Marketplace.Order memory order = _order(alice, tokenId, 1);
        bytes memory sig = _signListing(alicePk, order);

        vm.prank(alice);
        vm.expectRevert(Marketplace.SelfTrade.selector);
        market.buy(order, sig, emptyPermit());
    }

    function test_nonAllowlistedPayTokenIsRejected() public {
        uint256 tokenId = _giveAliceACard();
        Marketplace.Order memory order = _order(alice, tokenId, 1);
        order.payToken = address(0xbeef);
        bytes memory sig = _signListing(alicePk, order);

        vm.prank(bob);
        vm.expectRevert();
        market.buy(order, sig, emptyPermit());
    }
}

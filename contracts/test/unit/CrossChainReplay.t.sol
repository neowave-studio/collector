// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixture} from "../utils/Fixture.sol";
import {GachaMachine} from "../../src/GachaMachine.sol";
import {Marketplace} from "../../src/Marketplace.sol";

/// @notice Spec §3 [MUST][AUDIT][FIX M4-backend].
///
/// The suite is deployed with CREATE2 so every chain shares the same addresses. That makes the EIP-712
/// domain's `chainId` the ONLY thing standing between a signature on Base and the same signature
/// replayed on Polygon. These tests are the CI gate the spec requires: sign on chain A, assert the
/// exact same payload is rejected on chain B.
contract CrossChainReplayTest is Fixture {
    uint256 internal constant CHAIN_A = 8453; // Base
    uint256 internal constant CHAIN_B = 137; // Polygon

    function test_domainSeparatorIsChainSpecific() public {
        vm.chainId(CHAIN_A);
        bytes32 onA = gacha.domainSeparator();
        vm.chainId(CHAIN_B);
        bytes32 onB = gacha.domainSeparator();
        assertTrue(onA != onB, "domain separator must move with chainId");
    }

    function test_purchaseSignatureFromAnotherChainIsRejected() public {
        vm.chainId(CHAIN_A);
        GachaMachine.PurchaseAuth memory auth = purchaseAuth(alice, 1);
        bytes memory sigFromBase = signPurchase(alicePk, auth);

        // Sanity: it is a genuinely valid signature on its own chain.
        vm.prank(relayer);
        gacha.rip(auth, sigFromBase, emptyPermit());

        // Same contract address, same calldata, different chain.
        vm.chainId(CHAIN_B);
        GachaMachine.PurchaseAuth memory replay = auth;
        replay.nonce = gacha.nonces(alice);

        vm.prank(relayer);
        vm.expectRevert(GachaMachine.InvalidSignature.selector);
        gacha.rip(replay, sigFromBase, emptyPermit());
    }

    function test_buybackSignaturesFromAnotherChainAreRejected() public {
        vm.chainId(CHAIN_A);
        (uint256 drawId, GachaMachine.LeafProof memory proof) = ripAndReveal(alice, alicePk, 0);

        GachaMachine.BuybackAuth memory auth = GachaMachine.BuybackAuth({
            drawId: drawId,
            payToken: address(usdc),
            payout: 1e6,
            nonce: gacha.nonces(alice),
            deadline: uint48(block.timestamp + 30 minutes)
        });
        bytes memory userSig = signBuyback(alicePk, gacha.BUYBACK_USER_TYPEHASH(), auth);
        bytes memory oracleSig = signBuyback(oraclePk, gacha.BUYBACK_AUTH_TYPEHASH(), auth);

        vm.chainId(CHAIN_B);
        vm.prank(buybackRelayer);
        vm.expectRevert(GachaMachine.InvalidSignature.selector);
        gacha.settleBuyback(drawId, auth, userSig, oracleSig, proof);
    }

    function test_marketplaceOrderFromAnotherChainIsRejected() public {
        vm.chainId(CHAIN_A);
        (uint256 drawId, GachaMachine.LeafProof memory proof) = ripAndReveal(alice, alicePk, 0);
        vm.prank(alice);
        gacha.settle(drawId, proof);
        vm.prank(alice);
        nft.setApprovalForAll(address(market), true);

        Marketplace.Order memory order = Marketplace.Order({
            maker: alice,
            tokenId: proof.tokenId,
            price: 100e6,
            payToken: address(usdc),
            nonce: 1,
            expiry: uint48(block.timestamp + 1 days)
        });
        bytes memory sig = _sign(alicePk, market.hashListing(order));

        vm.chainId(CHAIN_B);
        vm.prank(bob);
        vm.expectRevert(Marketplace.InvalidSignature.selector);
        market.buy(order, sig, emptyPermit());
    }

    /// @notice A chain fork (same chainId splitting into two) must also invalidate signatures on the
    ///         new fork. OZ's EIP712 recomputes the separator whenever `block.chainid` moves.
    function test_signatureIsInvalidAfterAForkChangesTheChainId() public {
        GachaMachine.PurchaseAuth memory auth = purchaseAuth(alice, 1);
        bytes memory sig = signPurchase(alicePk, auth);

        vm.chainId(block.chainid + 1); // fork assigns a new chainId
        vm.prank(relayer);
        vm.expectRevert(GachaMachine.InvalidSignature.selector);
        gacha.rip(auth, sig, emptyPermit());
    }
}

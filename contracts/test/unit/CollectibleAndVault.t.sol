// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixture} from "../utils/Fixture.sol";
import {CollectibleNFT} from "../../src/CollectibleNFT.sol";
import {Vault} from "../../src/Vault.sol";
import {GachaMachine} from "../../src/GachaMachine.sol";

/// @notice Spec §5.1 / §5.2 / §7.1.10 — one token ↔ one certificate, redemption is terminal, and the
///         vault has exactly two exits.
contract CollectibleAndVaultTest is Fixture {
    function _deliverCardToAlice() internal returns (uint256 tokenId) {
        (uint256 drawId, GachaMachine.LeafProof memory proof) = ripAndReveal(alice, alicePk, 0);
        vm.prank(alice);
        gacha.settle(drawId, proof);
        tokenId = proof.tokenId;
    }

    // =============================================================================================
    // Identity
    // =============================================================================================

    function test_certificateCanBackOnlyOneToken() public {
        bytes32 commitment = keccak256(abi.encode("PSA-CERT", uint256(1))); // already backs tokenId 1
        vm.prank(minter);
        vm.expectRevert(abi.encodeWithSelector(CollectibleNFT.CommitmentAlreadyUsed.selector, commitment));
        nft.mint(alice, 777, commitment);
    }

    function test_tokenIdCannotBeMintedTwice() public {
        vm.prank(minter);
        vm.expectRevert(abi.encodeWithSelector(CollectibleNFT.TokenAlreadyExists.selector, uint256(1)));
        nft.mint(alice, 1, keccak256("fresh-cert"));
    }

    function test_emptyCommitmentIsRejected() public {
        vm.prank(minter);
        vm.expectRevert(CollectibleNFT.EmptyCommitment.selector);
        nft.mint(alice, 888, bytes32(0));
    }

    // =============================================================================================
    // Redemption
    // =============================================================================================

    function test_redeemBurnsAndCanNeverBeUndone() public {
        uint256 tokenId = _deliverCardToAlice();

        vm.prank(alice);
        nft.redeem(tokenId);

        assertTrue(nft.redeemed(tokenId));
        vm.expectRevert();
        nft.ownerOf(tokenId);

        // The card is gone forever: re-minting the same tokenId must be impossible even though
        // `_ownerOf` is zero again after the burn.
        vm.prank(minter);
        vm.expectRevert(abi.encodeWithSelector(CollectibleNFT.TokenRedeemed.selector, tokenId));
        nft.mint(alice, tokenId, keccak256("another-cert"));
    }

    function test_onlyTheOwnerMayRedeem() public {
        uint256 tokenId = _deliverCardToAlice();
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(CollectibleNFT.NotTokenOwner.selector, tokenId, bob));
        nft.redeem(tokenId);
    }

    function test_cannotRedeemTwice() public {
        uint256 tokenId = _deliverCardToAlice();
        vm.startPrank(alice);
        nft.redeem(tokenId);
        vm.expectRevert();
        nft.redeem(tokenId);
        vm.stopPrank();
    }

    // =============================================================================================
    // Fiat-chargeback holdback (spec §9)
    // =============================================================================================

    function test_transferLockBlocksTransferAndRedeemThenExpires() public {
        uint256 tokenId = _deliverCardToAlice();
        uint64 until = uint64(block.timestamp + 90 days);

        vm.prank(riskAdmin);
        nft.setTransferLock(tokenId, until);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CollectibleNFT.TransferLocked.selector, tokenId, until));
        nft.transferFrom(alice, bob, tokenId);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CollectibleNFT.TransferLocked.selector, tokenId, until));
        nft.redeem(tokenId);

        vm.warp(until);
        vm.prank(alice);
        nft.transferFrom(alice, bob, tokenId);
        assertEq(nft.ownerOf(tokenId), bob);
    }

    /// @notice The holdback is a delay, never a seizure: it is duration-capped in code and the risk
    ///         admin has no power to move or burn the token.
    function test_transferLockIsDurationCapped() public {
        uint256 tokenId = _deliverCardToAlice();
        // Resolve every external call BEFORE the prank so it is not consumed by an argument.
        uint64 max = uint64(block.timestamp) + nft.MAX_TRANSFER_LOCK();
        uint64 tooLong = max + 1;
        bytes memory expected = abi.encodeWithSelector(CollectibleNFT.LockTooLong.selector, tooLong, max);

        vm.prank(riskAdmin);
        vm.expectRevert(expected);
        nft.setTransferLock(tokenId, tooLong);
    }

    // =============================================================================================
    // Vault
    // =============================================================================================

    function test_onlyTheGachaMachineCanReleaseInventory() public {
        vm.prank(inventoryAdmin);
        vm.expectRevert();
        vault.releaseTo(inventoryAdmin, 1, PACK);
    }

    function test_releaseRequiresTheTokenToBelongToThatPack() public {
        vm.prank(address(gacha));
        vm.expectRevert(abi.encodeWithSelector(Vault.WrongPack.selector, uint256(1), keccak256("OTHER"), PACK));
        vault.releaseTo(alice, 1, keccak256("OTHER"));
    }

    function test_packAssignmentIsOneWay() public {
        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;
        vm.prank(inventoryAdmin);
        vm.expectRevert(abi.encodeWithSelector(Vault.AlreadyAssigned.selector, uint256(1), PACK));
        vault.assignPack(ids, keccak256("OTHER"));
    }

    function test_depositRejectsATokenAlreadyHeld() public {
        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;
        vm.prank(inventoryAdmin);
        vm.expectRevert(abi.encodeWithSelector(Vault.AlreadyHeld.selector, uint256(1)));
        vault.depositBatch(ids, PACK);
    }

    function test_vaultRejectsTokensFromAForeignCollection() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Vault.UnexpectedCollection.selector, alice));
        vault.onERC721Received(alice, alice, 1, "");
    }

    function test_releasedTokenLeavesInventoryAccounting() public {
        uint256 tokenId = _deliverCardToAlice();
        assertFalse(vault.isHeld(tokenId));
        assertEq(vault.tokenPack(tokenId), bytes32(0));
    }
}

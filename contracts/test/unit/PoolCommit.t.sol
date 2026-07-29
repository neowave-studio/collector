// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixture} from "../utils/Fixture.sol";
import {MerkleHelper} from "../utils/MerkleHelper.sol";
import {GachaMachine} from "../../src/GachaMachine.sol";
import {PoolLib} from "../../src/libraries/PoolLib.sol";
import {PoolCommitLib} from "../../src/libraries/PoolCommitLib.sol";
import {Vault} from "../../src/Vault.sol";
import {Roles} from "../../src/access/Roles.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

/// @notice Spec §5.3.1 — the contract must BUILD and VERIFY the odds partition itself. Everything
///         here is a rig the operator could have pulled off in the v1.0 design.
contract PoolCommitTest is Fixture {
    bytes32 internal constant PACK2 = keccak256("PKMN250");

    function _seedPack2(uint256 count) internal returns (uint256[] memory ids) {
        ids = new uint256[](count);
        bytes32[] memory commitments = new bytes32[](count);
        for (uint256 i; i < count; ++i) {
            ids[i] = 1000 + i;
            commitments[i] = keccak256(abi.encode("PSA-PACK2", i));
        }
        vm.prank(minter);
        nft.mintBatch(inventoryAdmin, ids, commitments);
        vm.startPrank(inventoryAdmin);
        nft.setApprovalForAll(address(vault), true);
        vault.depositBatch(ids, PACK2);
        vm.stopPrank();
    }

    function _leavesFor(uint256[] memory ids, uint256 weightEach, uint256 priceRef)
        internal
        pure
        returns (PoolLib.Leaf[] memory leaves)
    {
        leaves = new PoolLib.Leaf[](ids.length);
        uint256 cum;
        for (uint256 i; i < ids.length; ++i) {
            leaves[i] = PoolLib.Leaf({tokenId: ids[i], cumBefore: cum, weight: weightEach, priceRef: priceRef});
            cum += weightEach;
        }
    }

    // =============================================================================================
    // The committed root is the contract's, not the operator's
    // =============================================================================================

    function test_rootIsBuiltOnChainAndMatchesIndependentTree() public view {
        PoolLib.PoolVersion memory pv = gacha.getPoolVersion(PACK, VERSION);
        bytes32 expected = MerkleHelper.root(leafHashes(PACK, VERSION, defaultLeaves()));
        assertEq(pv.root, expected, "on-chain root must equal the canonical tree over the same leaves");
        assertEq(pv.totalWeight, TOTAL_WEIGHT);
        assertEq(pv.cardCount, 4);
        assertTrue(pv.finalized);
        assertEq(pv.poolCID, POOL_CID, "pool file CID must be on-chain so the file is tamper-evident");
    }

    function test_leafHashesRemainReadableOnChainForIndependentVerification() public view {
        assertEq(gacha.poolLeafCount(PACK, VERSION), 4);
        bytes32[] memory expected = leafHashes(PACK, VERSION, defaultLeaves());
        for (uint256 i; i < 4; ++i) {
            assertEq(gacha.poolLeafHash(PACK, VERSION, i), expected[i]);
        }
    }

    function test_maxReserveAndMaxBuybackDerivedFromHighestPriceRef() public view {
        PoolLib.PoolVersion memory pv = gacha.getPoolVersion(PACK, VERSION);
        assertEq(pv.maxReservePerRip, uint256(800e6) * UNAVAILABLE_BPS / 10_000);
        assertEq(pv.maxBuybackPerRip, uint256(800e6) * BUYBACK_BPS / 10_000);
    }

    // =============================================================================================
    // Partition integrity
    // =============================================================================================

    function test_revertsOnGapInPartition() public {
        uint256[] memory ids = _seedPack2(3);
        PoolLib.Leaf[] memory leaves = _leavesFor(ids, 10, 1e6);
        leaves[1].cumBefore = 11; // a one-unit hole no draw could ever resolve

        vm.prank(poolAuthor);
        vm.expectRevert(abi.encodeWithSelector(PoolCommitLib.PartitionGap.selector, 1, 10, 11));
        gacha.commitPool(PACK2, 1, _paramsFor(), leaves);
    }

    function test_revertsOnOverlappingSlices() public {
        uint256[] memory ids = _seedPack2(3);
        PoolLib.Leaf[] memory leaves = _leavesFor(ids, 10, 1e6);
        leaves[2].cumBefore = 15; // overlaps leaf 1 — two cards would claim the same weights

        vm.prank(poolAuthor);
        vm.expectRevert(abi.encodeWithSelector(PoolCommitLib.PartitionGap.selector, 2, 20, 15));
        gacha.commitPool(PACK2, 1, _paramsFor(), leaves);
    }

    function test_revertsOnZeroWeightLeaf() public {
        uint256[] memory ids = _seedPack2(2);
        PoolLib.Leaf[] memory leaves = _leavesFor(ids, 10, 1e6);
        leaves[1].weight = 0;

        vm.prank(poolAuthor);
        vm.expectRevert(abi.encodeWithSelector(PoolCommitLib.ZeroWeight.selector, 1));
        gacha.commitPool(PACK2, 1, _paramsFor(), leaves);
    }

    function test_revertsOnDuplicateTokenIdInPool() public {
        uint256[] memory ids = _seedPack2(2);
        PoolLib.Leaf[] memory leaves = _leavesFor(ids, 10, 1e6);
        leaves[1].tokenId = leaves[0].tokenId;

        vm.prank(poolAuthor);
        vm.expectRevert(abi.encodeWithSelector(PoolCommitLib.TokenIdsNotAscending.selector, 1));
        gacha.commitPool(PACK2, 1, _paramsFor(), leaves);
    }

    function test_revertsWhenPoolPromisesACardTheVaultDoesNotHold() public {
        uint256[] memory ids = _seedPack2(2);
        PoolLib.Leaf[] memory leaves = _leavesFor(ids, 10, 1e6);
        leaves[1].tokenId = 999_999; // never minted

        vm.prank(poolAuthor);
        vm.expectRevert(abi.encodeWithSelector(Vault.NotHeld.selector, 999_999));
        gacha.commitPool(PACK2, 1, _paramsFor(), leaves);
    }

    function test_revertsWhenPoolPullsACardEarmarkedToAnotherPack() public {
        uint256[] memory ids = _seedPack2(2);
        PoolLib.Leaf[] memory leaves = _leavesFor(ids, 10, 1e6);
        leaves[0].tokenId = 1; // belongs to PACK, not PACK2

        vm.prank(poolAuthor);
        vm.expectRevert(abi.encodeWithSelector(Vault.WrongPack.selector, 1, PACK2, PACK));
        gacha.commitPool(PACK2, 1, _paramsFor(), leaves);
    }

    // =============================================================================================
    // Immutability
    // =============================================================================================

    function test_committedVersionIsWriteOnce() public {
        vm.prank(poolAuthor);
        vm.expectRevert(abi.encodeWithSelector(PoolCommitLib.PoolAlreadyCommitted.selector, PACK, VERSION));
        gacha.commitPool(PACK, VERSION, defaultPoolParams(), defaultLeaves());
    }

    function test_cannotRestartADraftOnACommittedVersion() public {
        vm.prank(poolAuthor);
        vm.expectRevert(abi.encodeWithSelector(PoolCommitLib.PoolAlreadyCommitted.selector, PACK, VERSION));
        gacha.commitPoolStart(PACK, VERSION, defaultPoolParams());
    }

    function test_abortedVersionNumberIsRetiredForever() public {
        _seedPack2(2);
        vm.startPrank(poolAuthor);
        gacha.commitPoolStart(PACK2, 7, _paramsFor());
        gacha.abortPoolDraft(PACK2, 7);
        vm.expectRevert(abi.encodeWithSelector(GachaMachine.PoolVersionRetired.selector, PACK2, 7));
        gacha.commitPoolStart(PACK2, 7, _paramsFor());
        vm.stopPrank();
    }

    // =============================================================================================
    // Economics
    // =============================================================================================

    function test_revertsWhenExpectedBuybackExceedsRipPriceNetOfMargin() public {
        uint256[] memory ids = _seedPack2(2);
        // priceRef 100 USDC on every card at an 85% buyback = 85 USDC expected payout for a 50 USDC
        // rip: a money printer for anyone willing to rip-and-sell all day.
        PoolLib.Leaf[] memory leaves = _leavesFor(ids, 10, 100e6);

        vm.prank(poolAuthor);
        vm.expectRevert(
            abi.encodeWithSelector(
                PoolCommitLib.HouseMarginViolated.selector,
                uint256(BUYBACK_BPS) * (10 * 100e6 + 10 * 100e6),
                PRICE_PER_RIP * (10_000 - HOUSE_MARGIN_BPS) * 20
            )
        );
        gacha.commitPool(PACK2, 1, _paramsFor(), leaves);
    }

    function test_defaultPoolSatisfiesTheHouseMarginInvariant() public pure {
        // 0.85 × 45.40 = 38.59 ≤ 50 × 0.90 = 45.00
        uint256 weighted = 80 * 30e6 + 15 * 60e6 + 4 * 110e6 + 1 * 800e6;
        assertTrue(PoolLib.houseMarginHolds(weighted, 100, PRICE_PER_RIP, BUYBACK_BPS, HOUSE_MARGIN_BPS));
    }

    function test_revertsWhenUnavailableCompensationIsBelowBuyback() public {
        _seedPack2(2);
        PoolLib.PoolParams memory p = _paramsFor();
        p.unavailableBps = BUYBACK_BPS - 1; // would let a compensation exceed what was reserved

        vm.prank(poolAuthor);
        vm.expectRevert(PoolCommitLib.InvalidBps.selector);
        gacha.commitPoolStart(PACK2, 1, p);
    }

    function test_revertsOnNonAllowlistedPayToken() public {
        _seedPack2(2);
        PoolLib.PoolParams memory p = _paramsFor();
        p.payToken = address(0xdead);

        vm.prank(poolAuthor);
        vm.expectRevert();
        gacha.commitPoolStart(PACK2, 1, p);
    }

    // =============================================================================================
    // Chunked commitment
    // =============================================================================================

    function test_chunkedCommitProducesTheSameRootAsASingleCall() public {
        uint256[] memory ids = _seedPack2(9);
        PoolLib.Leaf[] memory leaves = _leavesFor(ids, 7, 2e6);

        vm.startPrank(poolAuthor);
        gacha.commitPoolStart(PACK2, 1, _paramsFor());

        PoolLib.Leaf[] memory first = new PoolLib.Leaf[](4);
        PoolLib.Leaf[] memory second = new PoolLib.Leaf[](5);
        for (uint256 i; i < 4; ++i) {
            first[i] = leaves[i];
        }
        for (uint256 i; i < 5; ++i) {
            second[i] = leaves[i + 4];
        }
        gacha.commitPoolChunk(PACK2, 1, first);

        (bool started, uint32 committed, uint256 cursor) = gacha.draftProgress(PACK2, 1);
        assertTrue(started);
        assertEq(committed, 4);
        assertEq(cursor, 28);

        gacha.commitPoolChunk(PACK2, 1, second);
        gacha.finalizePool(PACK2, 1);
        vm.stopPrank();

        assertEq(
            gacha.getPoolVersion(PACK2, 1).root,
            MerkleHelper.root(leafHashes(PACK2, 1, leaves)),
            "chunking must not change the tree"
        );
    }

    function test_chunkMustContinueExactlyWhereThePreviousOneEnded() public {
        uint256[] memory ids = _seedPack2(4);
        PoolLib.Leaf[] memory leaves = _leavesFor(ids, 10, 1e6);

        vm.startPrank(poolAuthor);
        gacha.commitPoolStart(PACK2, 1, _paramsFor());
        PoolLib.Leaf[] memory first = new PoolLib.Leaf[](2);
        first[0] = leaves[0];
        first[1] = leaves[1];
        gacha.commitPoolChunk(PACK2, 1, first);

        PoolLib.Leaf[] memory bad = new PoolLib.Leaf[](1);
        bad[0] = leaves[3]; // skips leaf 2's slice
        vm.expectRevert(abi.encodeWithSelector(PoolCommitLib.PartitionGap.selector, 2, 20, 30));
        gacha.commitPoolChunk(PACK2, 1, bad);
        vm.stopPrank();
    }

    function test_unfinalizedPoolIsNotRippable() public {
        _seedPack2(2);
        vm.prank(poolAuthor);
        gacha.commitPoolStart(PACK2, 1, _paramsFor());

        vm.prank(poolAuthor);
        vm.expectRevert(abi.encodeWithSelector(GachaMachine.PoolNotFinalized.selector, PACK2, 1));
        gacha.setActivePoolVersion(PACK2, 1, uint64(block.number + 20));
    }

    // =============================================================================================
    // Access control
    // =============================================================================================

    function test_onlyPoolAuthorMayCommit() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, alice, Roles.POOL_AUTHOR_ROLE
            )
        );
        gacha.commitPoolStart(PACK2, 1, _paramsFor());
    }

    function _paramsFor() internal view returns (PoolLib.PoolParams memory p) {
        p = defaultPoolParams();
    }
}

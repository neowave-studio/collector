// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Fixture} from "../utils/Fixture.sol";
import {PoolLib} from "../../src/libraries/PoolLib.sol";

/**
 * Measures what committing a large pool actually costs.
 *
 * Committing inventory is the single most gas-expensive thing this system does, and it scales linearly
 * with card count — so "how big a pool can we afford" is a question with a real answer, not a vibe.
 * Getting it wrong is expensive in a way that is hard to undo: a partially committed pool has no root
 * (by design), so an underfunded run leaves inventory minted and nothing sellable.
 *
 * These are the numbers the deployment cost model is built from. If the commit path gets more
 * expensive, this test is where that shows up.
 */
contract CommitGasTest is Fixture {
    function test_measureCommitGasPerLeaf() public {
        bytes32 pack = keccak256("gas.measurement.pack");
        uint256 version = 1;
        uint256 n = PoolLib.MAX_LEAVES_PER_CHUNK;

        // Inventory first. `commitPoolChunk` verifies every leaf's card is already in the vault under
        // this pack — it reverts WrongPack otherwise — so a commit cannot precede its inventory. The
        // ids start above the fixture's own so they do not collide.
        uint256 base = 1000;
        uint256[] memory ids = new uint256[](n);
        bytes32[] memory commitments = new bytes32[](n);
        for (uint256 i; i < n; ++i) {
            ids[i] = base + i;
            commitments[i] = keccak256(abi.encode("gas-measurement-cert", i));
        }

        vm.prank(minter);
        uint256 gm = gasleft();
        nft.mintBatch(inventoryAdmin, ids, commitments);
        uint256 mintGas = gm - gasleft();

        vm.prank(inventoryAdmin);
        nft.setApprovalForAll(address(vault), true);

        vm.prank(inventoryAdmin);
        uint256 gd = gasleft();
        vault.depositBatch(ids, pack);
        uint256 depositGas = gd - gasleft();

        vm.startPrank(poolAuthor);

        uint256 g0 = gasleft();
        gacha.commitPoolStart(pack, version, _params());
        uint256 startGas = g0 - gasleft();

        PoolLib.Leaf[] memory leaves = _leaves(n, 0, base);

        uint256 g1 = gasleft();
        gacha.commitPoolChunk(pack, version, leaves);
        uint256 chunkGas = g1 - gasleft();

        vm.stopPrank();

        emit log_named_uint("mintBatch gas (400)", mintGas);
        emit log_named_uint("  per card", mintGas / n);
        emit log_named_uint("depositBatch gas (400)", depositGas);
        emit log_named_uint("  per card", depositGas / n);

        emit log_named_uint("commitPoolStart gas", startGas);
        emit log_named_uint("commitPoolChunk gas (400 leaves)", chunkGas);
        emit log_named_uint("  per leaf", chunkGas / n);

        // `finalizePool` is deliberately not measured here. It re-checks that every leaf's card is
        // actually sitting in the vault under this pack — which is why it reverted with WrongPack
        // against synthetic token ids, and why a real commit must deposit inventory FIRST. Its cost
        // is a per-leaf storage read on top of the numbers above.

        // Guards the cost model. A regression here silently makes every future pool commit dearer.
        assertLt(chunkGas / n, 60_000, "per-leaf commit cost regressed beyond the cost model");
    }

    function _params() internal view returns (PoolLib.PoolParams memory) {
        return PoolLib.PoolParams({
            pricePerRip: 300e6,
            payToken: address(usdc),
            buybackBps: 8500,
            unavailableBps: 10_000,
            houseMarginBps: 1000,
            reserveBps: 4000,
            poolCID: keccak256("gas.measurement.cid")
        });
    }

    /// @dev A valid partition: strictly ascending token ids, contiguous weight slices from `cumStart`.
    function _leaves(uint256 n, uint256 cumStart, uint256 firstTokenId)
        internal
        pure
        returns (PoolLib.Leaf[] memory out)
    {
        out = new PoolLib.Leaf[](n);
        uint256 cum = cumStart;
        for (uint256 i; i < n; ++i) {
            out[i] = PoolLib.Leaf({tokenId: firstTokenId + i, cumBefore: cum, weight: 100, priceRef: 200e6});
            cum += 100;
        }
    }
}

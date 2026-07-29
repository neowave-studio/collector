// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {PoolLib} from "./PoolLib.sol";
import {MerkleTreeLib} from "./MerkleTreeLib.sol";
import {IVault} from "../interfaces/IVault.sol";
import {IPaymentRouter} from "../interfaces/IPaymentRouter.sol";

/// @title PoolCommitLib
/// @notice The contract-verified pool commitment machinery of spec §5.3.1, factored into a
///         `delegatecall` library.
///
/// @dev This is a deployment-shape change only — every function runs in the GachaMachine's own
///      storage and address context, so emitted events, thrown errors and access control behave
///      exactly as if the code were inline. It exists because the combined GachaMachine bytecode
///      exceeded the EIP-170 24,576-byte limit; the alternative (a separate PoolRegistry contract)
///      would have added an external call to every settlement, which is the hot path.
///
///      Because it is a linked library, deployment MUST record its address in `deployments.json` and
///      Etherscan verification MUST pass `--libraries`. The storage-layout CI gate covers the
///      GachaMachine, which is where all of this library's state actually lives.
library PoolCommitLib {
    error PoolAlreadyCommitted(bytes32 packId, uint256 version);
    error DraftNotStarted();
    error DraftAlreadyStarted();
    error InvalidVersion();
    error InvalidBps();
    error InvalidChunkSize();
    error PartitionGap(uint256 index, uint256 expectedCumBefore, uint256 actualCumBefore);
    error ZeroWeight(uint256 index);
    error TokenIdsNotAscending(uint256 index);
    error ValueOutOfBounds();
    error TooManyCards();
    error EmptyPool();
    error HouseMarginViolated(uint256 expectedPayout, uint256 allowed);

    event PoolDraftStarted(bytes32 indexed packId, uint256 indexed version, address payToken, uint256 pricePerRip);
    event PoolChunkCommitted(bytes32 indexed packId, uint256 indexed version, uint256 leavesSoFar, uint256 cumCursor);
    event PoolCommitted(
        bytes32 indexed packId,
        uint256 indexed version,
        bytes32 root,
        uint256 totalWeight,
        uint256 pricePerRip,
        address payToken,
        uint16 buybackBps,
        bytes32 poolCID
    );

    /// @notice Opens a draft and pins the version's economics.
    /// @dev Write-once is enforced here and again in {finalize}, so no path can overwrite live odds.
    function startDraft(
        PoolLib.PoolVersion storage pv,
        PoolLib.PoolDraft storage draft,
        bytes32 packId,
        uint256 version,
        PoolLib.PoolParams calldata params,
        address paymentRouter
    ) external {
        // Bounded to uint128 because `GachaMachine.Draw` stores the version in a uint128 field; an
        // unbounded version could truncate there and make two versions collide inside a draw record.
        if (version == 0 || version > type(uint128).max) revert InvalidVersion();
        if (pv.finalized) revert PoolAlreadyCommitted(packId, version);
        if (draft.started) revert DraftAlreadyStarted();

        // `unavailableBps >= buybackBps` guarantees the per-rip reservation covers BOTH resolution
        // payouts, so a compensation can never be unbacked.
        if (
            params.buybackBps > PoolLib.BPS || params.unavailableBps > PoolLib.BPS
                || params.unavailableBps < params.buybackBps || params.houseMarginBps > PoolLib.BPS
                || params.reserveBps > PoolLib.BPS
        ) revert InvalidBps();
        if (params.pricePerRip == 0 || params.pricePerRip > PoolLib.MAX_PRICE_REF) revert ValueOutOfBounds();
        IPaymentRouter(paymentRouter).requireAllowedPayToken(params.payToken);

        pv.pricePerRip = params.pricePerRip;
        pv.payToken = params.payToken;
        pv.buybackBps = params.buybackBps;
        pv.unavailableBps = params.unavailableBps;
        pv.houseMarginBps = params.houseMarginBps;
        pv.reserveBps = params.reserveBps;
        pv.poolCID = params.poolCID;

        draft.started = true;
        emit PoolDraftStarted(packId, version, params.payToken, params.pricePerRip);
    }

    /// @notice Appends the next slice of leaves, verifying the partition as it goes.
    ///
    /// Every rule enforced here is one the operator would otherwise be trusted on:
    ///  - `cumBefore` must continue exactly where the previous leaf ended  → no gaps, no overlaps;
    ///  - `weight > 0`                                                     → no unreachable dead leaf;
    ///  - tokenIds strictly ascending                                      → no card twice in one pool;
    ///  - every tokenId is vault-held and earmarked to `packId`            → 1:1 physical backing.
    function commitChunk(
        PoolLib.PoolVersion storage pv,
        PoolLib.PoolDraft storage draft,
        bytes32[] storage hashes,
        bytes32 packId,
        uint256 version,
        PoolLib.Leaf[] calldata leaves,
        address vault
    ) external {
        if (!draft.started) revert DraftNotStarted();
        if (pv.finalized) revert PoolAlreadyCommitted(packId, version);

        uint256 n = leaves.length;
        if (n == 0 || n > PoolLib.MAX_LEAVES_PER_CHUNK) revert InvalidChunkSize();
        if (draft.nextIndex + n > PoolLib.MAX_POOL_CARDS) revert TooManyCards();

        uint256 index = draft.nextIndex;
        uint256 cum = draft.cumCursor;
        uint256 lastTokenId = draft.lastTokenId;
        uint256 maxPriceRef = draft.maxPriceRef;
        uint256 weightedSum = draft.weightedPriceRefSum;

        uint256[] memory tokenIds = new uint256[](n);

        for (uint256 i; i < n; ++i) {
            PoolLib.Leaf calldata leaf = leaves[i];

            if (leaf.cumBefore != cum) revert PartitionGap(index, cum, leaf.cumBefore);
            if (leaf.weight == 0) revert ZeroWeight(index);
            if (leaf.weight > PoolLib.MAX_LEAF_WEIGHT || leaf.priceRef > PoolLib.MAX_PRICE_REF) {
                revert ValueOutOfBounds();
            }
            // index 0 may legitimately hold tokenId 0, hence the `index != 0` guard.
            if (index != 0 && leaf.tokenId <= lastTokenId) revert TokenIdsNotAscending(index);

            hashes.push(PoolLib.leafHash(packId, version, index, leaf));
            tokenIds[i] = leaf.tokenId;

            cum += leaf.weight;
            lastTokenId = leaf.tokenId;
            if (leaf.priceRef > maxPriceRef) maxPriceRef = leaf.priceRef;
            weightedSum += leaf.weight * leaf.priceRef;
            unchecked {
                ++index;
            }
        }

        // 1:1 backing: refuse to commit a pool that promises cards this pack does not hold.
        IVault(vault).requirePoolMembership(packId, tokenIds);

        // safe: `index` is bounded above by PoolLib.MAX_POOL_CARDS (20,000), checked on entry.
        // forge-lint: disable-next-line(unsafe-typecast)
        draft.nextIndex = uint32(index);
        draft.cumCursor = cum;
        draft.lastTokenId = lastTokenId;
        draft.maxPriceRef = maxPriceRef;
        draft.weightedPriceRefSum = weightedSum;

        emit PoolChunkCommitted(packId, version, index, cum);
    }

    /// @notice Verifies the economics, BUILDS the Merkle root from the accumulated leaf hashes, and
    ///         stores the commitment. Only here does `(packId, version)` become usable.
    function finalize(
        PoolLib.PoolVersion storage pv,
        PoolLib.PoolDraft storage draft,
        bytes32[] storage hashes,
        bytes32 packId,
        uint256 version
    ) external {
        if (!draft.started) revert DraftNotStarted();
        if (pv.finalized) revert PoolAlreadyCommitted(packId, version);

        uint32 cardCount = draft.nextIndex;
        if (cardCount == 0) revert EmptyPool();

        uint256 totalWeight = draft.cumCursor;
        if (totalWeight == 0 || totalWeight > PoolLib.MAX_TOTAL_WEIGHT) revert ValueOutOfBounds();

        // §5.3.1 FIX H1-fair — repeated rip→buyback must be provably house-non-negative.
        if (
            !PoolLib.houseMarginHolds(
                draft.weightedPriceRefSum, totalWeight, pv.pricePerRip, pv.buybackBps, pv.houseMarginBps
            )
        ) {
            revert HouseMarginViolated(
                pv.buybackBps * draft.weightedPriceRefSum, pv.pricePerRip * (PoolLib.BPS - pv.houseMarginBps) * totalWeight
            );
        }

        bytes32 root = MerkleTreeLib.computeRootFromStorage(hashes);

        pv.root = root;
        pv.totalWeight = totalWeight;
        pv.cardCount = cardCount;
        pv.maxReservePerRip = draft.maxPriceRef * pv.unavailableBps / PoolLib.BPS;
        pv.maxBuybackPerRip = draft.maxPriceRef * pv.buybackBps / PoolLib.BPS;
        pv.finalized = true;

        delete draft.started;
        delete draft.nextIndex;
        delete draft.cumCursor;
        delete draft.lastTokenId;
        delete draft.maxPriceRef;
        delete draft.weightedPriceRefSum;
        // The leaf hashes are deliberately NOT cleared. They are already paid for, and keeping them
        // makes the committed partition independently checkable leaf-by-leaf straight from chain
        // state — so a user can validate a published pool file even if every IPFS pin disappears.

        emit PoolCommitted(packId, version, root, totalWeight, pv.pricePerRip, pv.payToken, pv.buybackBps, pv.poolCID);
    }
}

// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

/// @title PoolLib
/// @notice Types, leaf encoding, numeric bounds and the economic invariant for committed gacha pools
///         (spec §5.3.1). Shared by `GachaMachine`, `PoolCommitLib`, the backend pool author and the
///         offline proof tool.
library PoolLib {
    /// @notice Domain tag mixed into every leaf so a pool leaf can never be confused with any other
    ///         hash in the system (spec §5.3.1 `DOMAIN_TAG`).
    bytes32 internal constant LEAF_DOMAIN_TAG = keccak256("collector.gacha.pool.leaf.v1");

    uint256 internal constant BPS = 10_000;

    /// @dev Bounds exist so that the §5.3.1 economic invariant and the reserve arithmetic can never
    ///      overflow. Derivation (worst case): S = Σ(weight·priceRef) ≤ 1e24·1e30 = 1e54;
    ///      buybackBps·S ≤ 1e58; pricePerRip·BPS·totalWeight ≤ 1e58 — both far below 2^256 ≈ 1.16e77.
    uint256 internal constant MAX_LEAF_WEIGHT = 1e18;
    uint256 internal constant MAX_TOTAL_WEIGHT = 1e24;
    uint256 internal constant MAX_PRICE_REF = 1e30;

    /// @dev Leaves per `commitPoolChunk` call. Bounds per-tx gas of partition verification.
    uint256 internal constant MAX_LEAVES_PER_CHUNK = 400;
    uint32 internal constant MAX_POOL_CARDS = 20_000;

    /// @notice One eligible card and its half-open weight slice `[cumBefore, cumBefore + weight)`.
    /// @param tokenId The specific vaulted CollectibleNFT this slice pays out.
    /// @param cumBefore Sum of all preceding leaf weights. Verified on-chain to be gap-free.
    /// @param weight Slice width. Must be > 0 (a zero-weight leaf would be unreachable dead data).
    /// @param priceRef Immutable fair-market reference used ONLY to cap buyback/unavailable payouts.
    struct Leaf {
        uint256 tokenId;
        uint256 cumBefore;
        uint256 weight;
        uint256 priceRef;
    }

    /// @notice Immutable economic + fairness commitment for one `(packId, version)`.
    struct PoolVersion {
        bytes32 root; // Merkle root, BUILT on-chain from verified leaves.
        bytes32 poolCID; // IPFS/Arweave CID of the published pool file.
        uint256 totalWeight;
        uint256 pricePerRip;
        uint256 maxReservePerRip; // maxPriceRef · unavailableBps / BPS — booked per rip.
        uint256 maxBuybackPerRip; // maxPriceRef · buybackBps  / BPS — published (spec `poolMaxBuyback`).
        address payToken;
        uint16 buybackBps;
        uint16 unavailableBps;
        uint16 houseMarginBps;
        uint16 reserveBps; // share of rip revenue routed to the ReserveVault.
        uint32 cardCount;
        uint32 releasedCount;
        bool finalized;
    }

    /// @notice Accumulator for a multi-transaction commit. Never readable as a committed pool: no root
    ///         is stored until the whole partition has been verified.
    struct PoolDraft {
        bool started;
        uint32 nextIndex;
        uint256 cumCursor; // expected `cumBefore` of the next leaf
        uint256 lastTokenId; // enforces strictly ascending tokenIds ⇒ no duplicate card in a pool
        uint256 maxPriceRef;
        uint256 weightedPriceRefSum; // Σ(weightᵢ · priceRefᵢ), for the house-margin invariant
    }

    struct PoolParams {
        uint256 pricePerRip;
        address payToken;
        uint16 buybackBps;
        uint16 unavailableBps;
        uint16 houseMarginBps;
        uint16 reserveBps;
        bytes32 poolCID;
    }

    /// @notice Canonical leaf hash. `packId` and `version` are inside the preimage so a proof can never
    ///         be replayed across packs or pool versions (spec FIX H5-sec).
    function leafHash(bytes32 packId, uint256 version, uint256 index, Leaf memory leaf)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                LEAF_DOMAIN_TAG, packId, version, index, leaf.tokenId, leaf.cumBefore, leaf.weight, leaf.priceRef
            )
        );
    }

    /// @notice Same as {leafHash} but from unpacked fields, for the `settle` calldata path.
    function leafHash(
        bytes32 packId,
        uint256 version,
        uint256 index,
        uint256 tokenId,
        uint256 cumBefore,
        uint256 weight,
        uint256 priceRef
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(LEAF_DOMAIN_TAG, packId, version, index, tokenId, cumBefore, weight, priceRef));
    }

    /// @notice The house-margin economic invariant (spec §5.3.1, FIX H1-fair).
    ///
    /// Expected buyback payout per rip must sit below the rip price net of the declared house margin:
    ///
    ///     Σ (wᵢ/W)·(buybackBps·priceRefᵢ/BPS)  ≤  pricePerRip·(BPS − houseMarginBps)/BPS
    ///
    /// Multiplied out to integer form (no division, so no rounding can be gamed):
    ///
    ///     buybackBps · Σ(wᵢ·priceRefᵢ)  ≤  pricePerRip · (BPS − houseMarginBps) · W
    ///
    /// A pool that fails this could be rip→buyback arbitraged until the reserve is empty, so
    /// `commitPool` refuses to store its root at all.
    /// @param weightedPriceRefSum Σ(weightᵢ · priceRefᵢ) over every leaf.
    function houseMarginHolds(
        uint256 weightedPriceRefSum,
        uint256 totalWeight,
        uint256 pricePerRip,
        uint256 buybackBps,
        uint256 houseMarginBps
    ) internal pure returns (bool) {
        uint256 expectedPayout = buybackBps * weightedPriceRefSum;
        uint256 allowed = pricePerRip * (BPS - houseMarginBps) * totalWeight;
        return expectedPayout <= allowed;
    }
}

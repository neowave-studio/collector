// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";

import {RoleGatedUpgradeable} from "./access/RoleGatedUpgradeable.sol";
import {Roles} from "./access/Roles.sol";
import {IVault} from "./interfaces/IVault.sol";
import {IReserveVault} from "./interfaces/IReserveVault.sol";
import {IPaymentRouter} from "./interfaces/IPaymentRouter.sol";
import {PoolLib} from "./libraries/PoolLib.sol";
import {PoolCommitLib} from "./libraries/PoolCommitLib.sol";
import {RandomLib} from "./libraries/RandomLib.sol";
import {VRFConsumerV2PlusUpgradeable} from "./vrf/VRFConsumerV2PlusUpgradeable.sol";

/// @title GachaMachine
/// @notice Provably-fair pack rips (spec §5.3). The whole competitive claim of this system lives here,
///         so every "the operator cannot cheat" statement below names the `require` that makes it true.
///
///  fairness    `commitPool` BUILDS the Merkle root from leaves it has itself verified to be a
///              gap-free, non-overlapping partition of `[0, totalWeight)`. Because the partition is
///              contract-verified, exactly ONE leaf can contain any given winning weight, so `settle`'s
///              proof check leaves the operator no choice about which card you get.
///  immutability `commitPool` is write-once per `(packId, version)`; a draw stores its `poolVersion`
///              atomically at `rip`, and every later step reads it from the stored draw, never calldata.
///  no front-run `setActivePoolVersion` only takes effect at a future block, and the user's own
///              signature pins the version — a swapped version makes `rip` revert, never silently
///              apply worse odds.
///  solvency    `rip` books the pool's worst-case payout with the ReserveVault and reverts if it
///              cannot be backed. You cannot sell a pack whose buyback you cannot pay.
///  liveness    A revealed draw is always deliverable (`claimAfterTimeout`, unpausable), always
///              compensable if its card is gone (`claimUnavailable`, unpausable), and an unfulfilled
///              rip is always refundable (`refundStuckRip`, unpausable). None of these need us alive.
contract GachaMachine is RoleGatedUpgradeable, EIP712Upgradeable, VRFConsumerV2PlusUpgradeable {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = PoolLib.BPS;

    // =============================================================================================
    // Types
    // =============================================================================================

    struct Draw {
        address user;
        bool revealed;
        bool settled;
        uint40 createdAt;
        uint40 revealedAt;
        bytes32 packId;
        uint128 poolVersion;
        uint128 winningWeight;
        uint128 reservedAmount;
        uint128 escrow;
    }

    struct VRFRequest {
        uint256 firstDrawId;
        uint32 count;
    }

    struct PurchaseAuth {
        address user;
        bytes32 packId;
        uint256 poolVersion;
        uint96 numRips;
        address payToken;
        uint256 amountPerRip;
        uint256 nonce;
        uint48 deadline;
    }

    struct BuybackAuth {
        uint256 drawId;
        address payToken;
        uint256 payout;
        uint256 nonce;
        uint48 deadline;
    }

    /// @notice Merkle opening of one pool leaf, supplied by anyone at settlement time.
    struct LeafProof {
        uint256 tokenId;
        uint256 cumBefore;
        uint256 weight;
        uint256 priceRef;
        uint256 leafIndex;
        bytes32[] proof;
    }

    // =============================================================================================
    // Constants
    // =============================================================================================

    bytes32 public constant PURCHASE_AUTH_TYPEHASH = keccak256(
        "PurchaseAuth(address user,bytes32 packId,uint256 poolVersion,uint96 numRips,address payToken,uint256 amountPerRip,uint256 nonce,uint48 deadline)"
    );
    bytes32 public constant BUYBACK_AUTH_TYPEHASH = keccak256(
        "BuybackAuth(uint256 drawId,address payToken,uint256 payout,uint256 nonce,uint48 deadline)"
    );
    bytes32 public constant BUYBACK_USER_TYPEHASH = keccak256(
        "BuybackUser(uint256 drawId,address payToken,uint256 payout,uint256 nonce,uint48 deadline)"
    );

    /// @dev Bounds the VRF callback's reveal loop so it always fits `vrfCallbackGasLimit`.
    uint96 public constant MAX_RIPS_PER_TX = 10;

    // =============================================================================================
    // Storage
    // =============================================================================================

    IVault public vault;
    IReserveVault public reserveVault;
    IPaymentRouter public paymentRouter;
    address public treasury;

    /// @notice `packId => version => commitment`. Write-once per version (spec FIX C2-sec).
    mapping(bytes32 packId => mapping(uint256 version => PoolLib.PoolVersion)) public poolVersions;
    mapping(bytes32 packId => mapping(uint256 version => PoolLib.PoolDraft)) private _drafts;
    /// @notice Verified leaf hashes, kept permanently so the committed partition can be re-checked
    ///         from chain state alone if the published pool file's pins ever vanish.
    mapping(bytes32 packId => mapping(uint256 version => bytes32[])) private _poolLeafHashes;

    /// @notice Version numbers retired by `abortPoolDraft`. Never reusable.
    mapping(bytes32 packId => mapping(uint256 version => bool)) public poolVersionBurned;

    /// @notice Version currently in force (already past its announced activation block).
    mapping(bytes32 packId => uint256) public settledActiveVersion;
    /// @notice Announced next version, effective from `activeFromBlock`.
    mapping(bytes32 packId => uint256) public scheduledVersion;
    mapping(bytes32 packId => uint64) public activeFromBlock;

    mapping(uint256 drawId => Draw) public draws;
    mapping(uint256 vrfRequestId => VRFRequest) public vrfRequests;
    mapping(address user => uint256) public nonces;

    /// @notice Unresolved draws per pack. Gates `Vault.sweepTo` (spec FIX M4-sec).
    mapping(bytes32 packId => uint256) public pendingDraws;

    /// @notice User escrow held for unresolved draws — never withdrawable as revenue.
    mapping(address token => uint256) public escrowedFunds;
    mapping(address token => uint256) public pendingReserveRevenue;
    mapping(address token => uint256) public pendingTreasuryRevenue;

    /// @notice Buyback holdback while a fiat payment is still reversible (spec §9 FIX C4-backend).
    ///         Never blocks card delivery — only the cash-out path.
    mapping(address user => uint64) public buybackLockedUntil;

    uint256 public nextDrawId;

    /// @notice Window after reveal in which the user may take buyback instead of the card, and during
    ///         which delivery is restricted to the user/relayer so nobody can force their hand.
    uint64 public buybackWindow;
    /// @notice After this long without a VRF answer, the rip is refundable.
    uint64 public ripRevealTimeout;
    /// @notice Share of a pool's cards that may be released before `rip` refuses the version as stale.
    uint16 public poolStaleThresholdBps;

    uint64 public constant MIN_BUYBACK_WINDOW = 5 minutes;
    uint64 public constant MAX_BUYBACK_WINDOW = 7 days;
    uint64 public constant MIN_RIP_REVEAL_TIMEOUT = 10 minutes;
    uint64 public constant MAX_RIP_REVEAL_TIMEOUT = 7 days;
    uint16 public constant MAX_POOL_STALE_THRESHOLD_BPS = 5000;
    uint64 public constant MAX_BUYBACK_LOCK = 150 days;

    // =============================================================================================
    // Errors
    // =============================================================================================

    error PoolAlreadyCommitted(bytes32 packId, uint256 version);
    error PoolNotFinalized(bytes32 packId, uint256 version);
    error PoolVersionRetired(bytes32 packId, uint256 version);
    error DraftNotStarted();
    error ActivationTooSoon(uint64 activeFromBlock, uint256 minimum);
    error PoolVersionMismatch(uint256 signed, uint256 active);
    error PoolStale(uint32 released, uint32 total);
    error SignatureExpired(uint48 deadline);
    error InvalidNonce(uint256 provided, uint256 expected);
    error InvalidSignature();
    error TermsMismatch();
    error InvalidRipCount(uint96 numRips);
    error UnknownVRFRequest(uint256 requestId);
    error DrawNotRevealed(uint256 drawId);
    error DrawAlreadySettled(uint256 drawId);
    error DrawAlreadyRevealed(uint256 drawId);
    error WeightOutsideSlice(uint256 winningWeight, uint256 cumBefore, uint256 weight);
    error BadMerkleProof();
    error BuybackWindowClosed(uint256 drawId);
    error BuybackWindowOpen(uint256 drawId);
    error BuybackLocked(address user, uint64 until);
    error PayoutExceedsCap(uint256 payout, uint256 cap);
    error NotDrawUser(uint256 drawId);
    error RevealNotTimedOut(uint256 drawId);
    error CardStillAvailable(uint256 tokenId);
    error CardNotAvailable(uint256 tokenId);
    error ParamOutOfRange();
    error LockTooLong();

    // =============================================================================================
    // Events
    // =============================================================================================

    event PoolDraftAborted(bytes32 indexed packId, uint256 indexed version);
    event ActiveVersionScheduled(bytes32 indexed packId, uint256 indexed version, uint64 activeFromBlock);
    event RipRequested(
        address indexed user,
        bytes32 indexed packId,
        uint256 indexed poolVersion,
        uint256 firstDrawId,
        uint96 numRips,
        uint256 vrfRequestId
    );
    event RipRevealed(uint256 indexed drawId, uint256 winningWeight);
    event RevealFailed(uint256 indexed drawId, uint256 vrfRequestId);
    event RipSettled(uint256 indexed drawId, address indexed user, uint256 indexed tokenId, bool viaTimeout);
    event BuybackSettled(uint256 indexed drawId, address indexed user, uint256 payout, uint256 tokenId);
    event DrawUnavailable(uint256 indexed drawId, address indexed user, uint256 indexed tokenId, uint256 payout);
    event RipRefunded(uint256 indexed drawId, address indexed user, uint256 amount);
    event RevenueFlushed(address indexed token, uint256 toReserve, uint256 toTreasury);
    event TreasuryUpdated(address indexed treasury);
    event BuybackLockSet(address indexed user, uint64 until, address indexed by);
    event TimingParamsUpdated(uint64 buybackWindow, uint64 ripRevealTimeout, uint16 poolStaleThresholdBps);

    // =============================================================================================
    // Init
    // =============================================================================================

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    struct InitParams {
        address accessController;
        address vault;
        address reserveVault;
        address paymentRouter;
        address treasury;
        address vrfCoordinator;
        uint256 vrfSubscriptionId;
        bytes32 vrfKeyHash;
        uint32 vrfCallbackGasLimit;
        uint16 vrfRequestConfirmations;
        bool vrfNativePayment;
        uint64 buybackWindow;
        uint64 ripRevealTimeout;
        uint16 poolStaleThresholdBps;
    }

    function initialize(InitParams calldata p) external initializer {
        if (
            p.vault == address(0) || p.reserveVault == address(0) || p.paymentRouter == address(0)
                || p.treasury == address(0)
        ) revert ZeroAddress();

        __RoleGated_init(p.accessController);
        // Domain separator embeds chainId + verifyingContract and is recomputed on a chain fork,
        // which is what actually stops cross-chain replay between our identical CREATE2 addresses.
        __EIP712_init("CollectorGacha", "1");
        __VRFConsumer_init(
            p.vrfCoordinator,
            p.vrfSubscriptionId,
            p.vrfKeyHash,
            p.vrfCallbackGasLimit,
            p.vrfRequestConfirmations,
            p.vrfNativePayment
        );

        vault = IVault(p.vault);
        reserveVault = IReserveVault(p.reserveVault);
        paymentRouter = IPaymentRouter(p.paymentRouter);
        treasury = p.treasury;
        nextDrawId = 1;
        _setTimingParams(p.buybackWindow, p.ripRevealTimeout, p.poolStaleThresholdBps);
    }

    // =============================================================================================
    // §5.3.1 — Pool commitment: contract-verified partition
    // =============================================================================================

    /// @notice Opens a draft for `(packId, version)` and pins its economics.
    /// @dev Body lives in {PoolCommitLib}; it executes by `delegatecall` in this contract's storage
    ///      and address context, so events, errors and state are identical to an inline implementation.
    function commitPoolStart(bytes32 packId, uint256 version, PoolLib.PoolParams calldata params)
        public
        onlyRole(Roles.POOL_AUTHOR_ROLE)
    {
        if (poolVersionBurned[packId][version]) revert PoolVersionRetired(packId, version);
        PoolCommitLib.startDraft(
            poolVersions[packId][version], _drafts[packId][version], packId, version, params, address(paymentRouter)
        );
    }

    /// @notice Appends the next slice of leaves, verifying the partition as it goes.
    function commitPoolChunk(bytes32 packId, uint256 version, PoolLib.Leaf[] calldata leaves)
        public
        onlyRole(Roles.POOL_AUTHOR_ROLE)
    {
        PoolCommitLib.commitChunk(
            poolVersions[packId][version],
            _drafts[packId][version],
            _poolLeafHashes[packId][version],
            packId,
            version,
            leaves,
            address(vault)
        );
    }

    /// @notice Verifies the economics, BUILDS the Merkle root from the verified leaves, and stores the
    ///         commitment. Only after this does `(packId, version)` become rippable.
    function finalizePool(bytes32 packId, uint256 version) public onlyRole(Roles.POOL_AUTHOR_ROLE) {
        PoolCommitLib.finalize(
            poolVersions[packId][version], _drafts[packId][version], _poolLeafHashes[packId][version], packId, version
        );
    }

    /// @notice Single-transaction convenience path for pools that fit one chunk.
    function commitPool(
        bytes32 packId,
        uint256 version,
        PoolLib.PoolParams calldata params,
        PoolLib.Leaf[] calldata leaves
    ) external {
        commitPoolStart(packId, version, params);
        commitPoolChunk(packId, version, leaves);
        finalizePool(packId, version);
    }

    /// @notice Discards an unfinalized draft (e.g. a mistyped chunk).
    /// @dev The aborted version number is RETIRED rather than freed. Clearing an up-to-20,000-entry
    ///      leaf array would be unbounded gas, and silently reusing the number would let a restarted
    ///      draft append to the abandoned leaves and commit a tree nobody intended. Ops simply moves
    ///      to `version + 1`.
    function abortPoolDraft(bytes32 packId, uint256 version) external onlyRole(Roles.POOL_AUTHOR_ROLE) {
        if (poolVersions[packId][version].finalized) revert PoolAlreadyCommitted(packId, version);
        if (!_drafts[packId][version].started) revert DraftNotStarted();
        delete _drafts[packId][version];
        delete poolVersions[packId][version];
        poolVersionBurned[packId][version] = true;
        emit PoolDraftAborted(packId, version);
    }

    /// @notice Announces the next active version. Never same-block (spec FIX C1-fair).
    /// @param activeFromBlock_ A future block, at least `minActivationDelayBlocks()` ahead, so a
    ///        version flip can never be sandwiched around a user's in-flight rip.
    function setActivePoolVersion(bytes32 packId, uint256 version, uint64 activeFromBlock_)
        external
        onlyRole(Roles.POOL_AUTHOR_ROLE)
    {
        if (!poolVersions[packId][version].finalized) revert PoolNotFinalized(packId, version);
        uint256 minimum = block.number + minActivationDelayBlocks();
        if (activeFromBlock_ < minimum) revert ActivationTooSoon(activeFromBlock_, minimum);

        // Promote an already-due schedule first so it is not silently skipped.
        settledActiveVersion[packId] = activePoolVersion(packId);
        scheduledVersion[packId] = version;
        activeFromBlock[packId] = activeFromBlock_;
        emit ActiveVersionScheduled(packId, version, activeFromBlock_);
    }

    /// @notice The version in force right now.
    function activePoolVersion(bytes32 packId) public view returns (uint256) {
        uint256 scheduled = scheduledVersion[packId];
        if (scheduled != 0 && block.number >= activeFromBlock[packId]) return scheduled;
        return settledActiveVersion[packId];
    }

    /// @dev Kept as a function so an upgrade can tune it per chain (block times differ by 100x
    ///      between Ethereum and an L2) without touching the activation logic.
    function minActivationDelayBlocks() public pure returns (uint256) {
        return 10;
    }

    // =============================================================================================
    // §5.3.2 — Draw lifecycle
    // =============================================================================================

    /// @notice Buys `auth.numRips` rips for `auth.user` and requests VRF randomness.
    /// @dev Two independent authorizations are required and both are load-bearing:
    ///      the USER's EIP-712 signature pins odds version, token, price and count (so we can neither
    ///      overcharge them nor move them to different odds), and the CALLER must hold
    ///      TRUSTED_RELAYER_ROLE (so the backend's geofence / age / KYC gate cannot be bypassed by
    ///      calling the contract directly — spec §12 requires the jurisdiction check to sit before
    ///      payment).
    function rip(PurchaseAuth calldata auth, bytes calldata userSig, IPaymentRouter.PaymentPermit calldata payment)
        external
        nonReentrant
        whenNotPaused
        onlyRole(Roles.TRUSTED_RELAYER_ROLE)
        returns (uint256 firstDrawId)
    {
        uint256 version = _validateRip(auth, userSig);
        firstDrawId = _openDraws(auth, version);
        _collectAndReserve(auth, version, payment);

        uint256 requestId = _requestRandomWords(uint32(auth.numRips));
        vrfRequests[requestId] = VRFRequest({firstDrawId: firstDrawId, count: uint32(auth.numRips)});

        emit RipRequested(auth.user, auth.packId, version, firstDrawId, auth.numRips, requestId);
    }

    /// @dev All of `rip`'s checks, isolated so the hot path stays within the EVM's stack limits.
    function _validateRip(PurchaseAuth calldata auth, bytes calldata userSig) private returns (uint256 version) {
        if (auth.numRips == 0 || auth.numRips > MAX_RIPS_PER_TX) revert InvalidRipCount(auth.numRips);
        if (block.timestamp > auth.deadline) revert SignatureExpired(auth.deadline);

        // The version the user signed must still be the active one. A front-run flip reverts here
        // rather than silently applying different odds.
        version = activePoolVersion(auth.packId);
        if (auth.poolVersion != version) revert PoolVersionMismatch(auth.poolVersion, version);

        PoolLib.PoolVersion storage pv = poolVersions[auth.packId][version];
        if (!pv.finalized) revert PoolNotFinalized(auth.packId, version);
        if (auth.payToken != pv.payToken || auth.amountPerRip != pv.pricePerRip) revert TermsMismatch();

        // Liveness breaker: once too much of a pool has been won, its odds no longer describe what is
        // actually deliverable, so ops must publish a new version before selling more rips.
        if (uint256(pv.releasedCount) * BPS > uint256(pv.cardCount) * poolStaleThresholdBps) {
            revert PoolStale(pv.releasedCount, pv.cardCount);
        }

        _consumeNonce(auth.user, auth.nonce);
        _requireSignature(auth.user, _purchaseAuthHash(auth), userSig);
    }

    function _openDraws(PurchaseAuth calldata auth, uint256 version) private returns (uint256 firstDrawId) {
        PoolLib.PoolVersion storage pv = poolVersions[auth.packId][version];
        uint128 perDrawReserve = uint128(pv.maxReservePerRip);
        uint128 perDrawEscrow = uint128(pv.pricePerRip);

        firstDrawId = nextDrawId;
        for (uint256 i; i < auth.numRips; ++i) {
            draws[firstDrawId + i] = Draw({
                user: auth.user,
                revealed: false,
                settled: false,
                createdAt: uint40(block.timestamp),
                revealedAt: 0,
                packId: auth.packId,
                // safe: `commitPoolStart` rejects any version above type(uint128).max.
                // forge-lint: disable-next-line(unsafe-typecast)
                poolVersion: uint128(version),
                winningWeight: 0,
                reservedAmount: perDrawReserve,
                escrow: perDrawEscrow
            });
        }
        nextDrawId = firstDrawId + auth.numRips;
        pendingDraws[auth.packId] += auth.numRips;
        escrowedFunds[pv.payToken] += uint256(perDrawEscrow) * auth.numRips;
    }

    function _collectAndReserve(
        PurchaseAuth calldata auth,
        uint256 version,
        IPaymentRouter.PaymentPermit calldata payment
    ) private {
        PoolLib.PoolVersion storage pv = poolVersions[auth.packId][version];
        address payToken = pv.payToken;
        uint256 total = pv.pricePerRip * auth.numRips;
        uint256 reserveAmount = pv.maxReservePerRip * auth.numRips;

        // Payment first so a failed pull costs no reservation churn.
        paymentRouter.collectForRip(
            auth.user, payToken, total, address(this), auth.packId, version, auth.numRips, payment
        );
        // Reverts if the reserve cannot back the worst case → we never sell an unbacked pack.
        if (reserveAmount != 0) reserveVault.reserve(payToken, reserveAmount);
    }

    /// @notice VRF callback. Kept deliberately light: storage writes and events only.
    /// @dev Idempotent per draw (`revealed` guard) and per request (the request entry is deleted).
    ///      A draw that cannot be reduced without bias is left unrevealed rather than reverting the
    ///      whole callback, because a revert here would strand every draw in the batch; the affected
    ///      user recovers through `refundStuckRip`.
    function _fulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) internal override {
        VRFRequest memory req = vrfRequests[requestId];
        if (req.count == 0) revert UnknownVRFRequest(requestId);
        delete vrfRequests[requestId];

        uint256 words = randomWords.length;
        for (uint256 i; i < req.count; ++i) {
            uint256 drawId = req.firstDrawId + i;
            Draw storage d = draws[drawId];
            if (d.revealed || d.settled) continue;
            if (i >= words) {
                emit RevealFailed(drawId, requestId);
                continue;
            }

            uint256 totalWeight = poolVersions[d.packId][d.poolVersion].totalWeight;
            (uint256 w, bool ok) = RandomLib.uniformBelow(randomWords[i], totalWeight);
            if (!ok) {
                emit RevealFailed(drawId, requestId);
                continue;
            }

            // safe: `w < totalWeight <= PoolLib.MAX_TOTAL_WEIGHT` (1e24), far below 2^128.
            // forge-lint: disable-next-line(unsafe-typecast)
            d.winningWeight = uint128(w);
            d.revealed = true;
            d.revealedAt = uint40(block.timestamp);
            emit RipRevealed(drawId, w);
        }
    }

    /// @notice Delivers the drawn card. Anyone may push a settlement — the contract, not the caller,
    ///         decides which card is correct.
    /// @dev During the buyback window delivery is restricted to the draw's user or the relayer, so a
    ///      third party cannot force delivery and destroy the user's option to cash out. Once the
    ///      window closes it is fully permissionless.
    function settle(uint256 drawId, LeafProof calldata leafProof) external nonReentrant whenNotPaused {
        Draw storage d = draws[drawId];
        // Checked before the window logic so an unrevealed draw reports why it cannot settle rather
        // than reporting the caller restriction it also happens to trip (`revealedAt` is still 0).
        if (!d.revealed) revert DrawNotRevealed(drawId);
        if (block.timestamp <= uint256(d.revealedAt) + buybackWindow) {
            if (msg.sender != d.user && !hasRole(Roles.TRUSTED_RELAYER_ROLE, msg.sender)) {
                revert NotDrawUser(drawId);
            }
        }
        _deliver(drawId, leafProof, false);
    }

    /// @notice Unpausable delivery floor (spec FIX C1-backend, H2-sec). Once the buyback window has
    ///         passed, ANYONE can deliver a revealed draw to its user — even if we are paused, even if
    ///         our backend is gone. This is the guarantee that makes self-custody real.
    function claimAfterTimeout(uint256 drawId, LeafProof calldata leafProof) external nonReentrant {
        Draw storage d = draws[drawId];
        if (block.timestamp <= uint256(d.revealedAt) + buybackWindow) revert BuybackWindowOpen(drawId);
        _deliver(drawId, leafProof, true);
    }

    function _deliver(uint256 drawId, LeafProof calldata leafProof, bool viaTimeout) private {
        Draw storage d = draws[drawId];
        if (!d.revealed) revert DrawNotRevealed(drawId);
        if (d.settled) revert DrawAlreadySettled(drawId);

        // Effects before interactions: the single-use guard closes before any external call.
        d.settled = true;

        bytes32 packId = d.packId; // read ONLY from stored draw state (spec FIX M4-fair)
        uint256 version = d.poolVersion;
        _verifyLeaf(packId, version, d.winningWeight, leafProof);

        PoolLib.PoolVersion storage pv = poolVersions[packId][version];
        pv.releasedCount += 1;
        pendingDraws[packId] -= 1;

        uint256 reserved = d.reservedAmount;
        uint256 escrow = d.escrow;
        address payToken = pv.payToken;
        escrowedFunds[payToken] -= escrow;
        _bookRevenue(payToken, escrow, pv.reserveBps);

        if (reserved != 0) reserveVault.unreserve(payToken, reserved);
        vault.releaseTo(d.user, leafProof.tokenId, packId);

        emit RipSettled(drawId, d.user, leafProof.tokenId, viaTimeout);
    }

    /// @notice Compensates a user whose drawn card has already left the vault.
    ///
    /// @dev NOT in the original spec — added because the spec has no answer for two draws landing on
    ///      the same slice, which strands the second user's payment permanently. The compensation is
    ///      `unavailableBps · priceRef` (default 100% of the committed reference value), it is always
    ///      covered because `rip` reserved `maxPriceRef · unavailableBps` for this draw, and it is
    ///      unpausable and permissionless. `rip`'s staleness breaker keeps this a rare tail event
    ///      rather than a business model.
    function claimUnavailable(uint256 drawId, LeafProof calldata leafProof) external nonReentrant {
        Draw storage d = draws[drawId];
        if (!d.revealed) revert DrawNotRevealed(drawId);
        if (d.settled) revert DrawAlreadySettled(drawId);
        d.settled = true;

        bytes32 packId = d.packId;
        uint256 version = d.poolVersion;
        _verifyLeaf(packId, version, d.winningWeight, leafProof);

        // Only reachable when the card genuinely cannot be delivered.
        if (vault.isHeld(leafProof.tokenId) && vault.tokenPack(leafProof.tokenId) == packId) {
            revert CardStillAvailable(leafProof.tokenId);
        }

        PoolLib.PoolVersion storage pv = poolVersions[packId][version];
        pendingDraws[packId] -= 1;

        uint256 payout = leafProof.priceRef * pv.unavailableBps / BPS;
        uint256 reserved = d.reservedAmount;
        if (payout > reserved) payout = reserved; // arithmetic floor; unreachable by construction

        address payToken = pv.payToken;
        uint256 escrow = d.escrow;
        escrowedFunds[payToken] -= escrow;
        _bookRevenue(payToken, escrow, pv.reserveBps);

        if (payout != 0) {
            reserveVault.payFromReservation(payToken, d.user, payout, reserved);
        } else if (reserved != 0) {
            reserveVault.unreserve(payToken, reserved);
        }

        emit DrawUnavailable(drawId, d.user, leafProof.tokenId, payout);
    }

    /// @notice Refunds a rip whose randomness never arrived (spec FIX H5-backend, M3-fair).
    /// @dev Permissionless and unpausable. Funds always go to the draw's user, so a third party
    ///      calling it can only help; this also lets ops clear stuck draws that block `sweepTo`.
    function refundStuckRip(uint256 drawId) external nonReentrant {
        Draw storage d = draws[drawId];
        if (d.settled) revert DrawAlreadySettled(drawId);
        if (d.revealed) revert DrawAlreadyRevealed(drawId);
        if (d.user == address(0)) revert DrawNotRevealed(drawId);
        if (block.timestamp < uint256(d.createdAt) + ripRevealTimeout) revert RevealNotTimedOut(drawId);

        d.settled = true;

        bytes32 packId = d.packId;
        PoolLib.PoolVersion storage pv = poolVersions[packId][d.poolVersion];
        pendingDraws[packId] -= 1;

        uint256 escrow = d.escrow;
        uint256 reserved = d.reservedAmount;
        address payToken = pv.payToken;
        escrowedFunds[payToken] -= escrow;

        if (reserved != 0) reserveVault.unreserve(payToken, reserved);
        if (escrow != 0) IERC20(payToken).safeTransfer(d.user, escrow);

        emit RipRefunded(drawId, d.user, escrow);
    }

    // =============================================================================================
    // §5.3.3 — Buyback
    // =============================================================================================

    /// @notice Instant sell-back of a revealed draw at an on-chain-capped price.
    /// @dev Requires THREE independent authorizations, which is what bounds the damage from any one
    ///      compromised key (spec §8.8): the oracle's signature over the price, the user's signature
    ///      accepting it, and the caller holding TRUSTED_BUYBACK_ROLE. On top of that the payout is
    ///      capped by the draw's own immutable `priceRef`, the window is bounded, and the
    ///      ReserveVault applies a per-epoch outflow ceiling.
    function settleBuyback(
        uint256 drawId,
        BuybackAuth calldata auth,
        bytes calldata userSig,
        bytes calldata oracleSig,
        LeafProof calldata leafProof
    ) external nonReentrant whenNotPaused onlyRole(Roles.TRUSTED_BUYBACK_ROLE) {
        Draw storage d = draws[drawId];
        if (!d.revealed) revert DrawNotRevealed(drawId);
        if (d.settled) revert DrawAlreadySettled(drawId);
        if (auth.drawId != drawId) revert TermsMismatch();
        if (block.timestamp > auth.deadline) revert SignatureExpired(auth.deadline);
        if (block.timestamp > uint256(d.revealedAt) + buybackWindow) revert BuybackWindowClosed(drawId);

        uint64 lockedUntil = buybackLockedUntil[d.user];
        if (block.timestamp < lockedUntil) revert BuybackLocked(d.user, lockedUntil);

        d.settled = true;

        bytes32 packId = d.packId;
        uint256 version = d.poolVersion;
        // Identifies WHICH card was drawn, so the cap below uses that card's committed reference
        // price rather than anything the oracle asserts.
        _verifyLeaf(packId, version, d.winningWeight, leafProof);

        PoolLib.PoolVersion storage pv = poolVersions[packId][version];
        if (auth.payToken != pv.payToken) revert TermsMismatch();

        uint256 cap = leafProof.priceRef * pv.buybackBps / BPS;
        if (auth.payout > cap) revert PayoutExceedsCap(auth.payout, cap);

        _consumeNonce(d.user, auth.nonce);
        _requireSignature(d.user, _buybackHash(BUYBACK_USER_TYPEHASH, auth), userSig);
        _requireOracleSignature(_buybackHash(BUYBACK_AUTH_TYPEHASH, auth), oracleSig);

        pendingDraws[packId] -= 1;

        uint256 reserved = d.reservedAmount;
        uint256 escrow = d.escrow;
        address payToken = pv.payToken;
        escrowedFunds[payToken] -= escrow;
        _bookRevenue(payToken, escrow, pv.reserveBps);

        if (auth.payout != 0) {
            reserveVault.payFromReservation(payToken, d.user, auth.payout, reserved);
        } else if (reserved != 0) {
            reserveVault.unreserve(payToken, reserved);
        }

        // The card stays in the vault and returns to inventory for a future pool version.
        emit BuybackSettled(drawId, d.user, auth.payout, leafProof.tokenId);
    }

    // =============================================================================================
    // Revenue
    // =============================================================================================

    function _bookRevenue(address token, uint256 amount, uint16 reserveBps) private {
        if (amount == 0) return;
        uint256 toReserve = amount * reserveBps / BPS;
        pendingReserveRevenue[token] += toReserve;
        pendingTreasuryRevenue[token] += amount - toReserve;
    }

    /// @notice Pushes realised rip revenue to the ReserveVault and the treasury.
    /// @dev Permissionless: it moves already-earned funds to their committed destinations and can
    ///      never touch `escrowedFunds`, so there is no reason to gate it.
    function flushRevenue(address token) external nonReentrant {
        uint256 toReserve = pendingReserveRevenue[token];
        uint256 toTreasury = pendingTreasuryRevenue[token];
        pendingReserveRevenue[token] = 0;
        pendingTreasuryRevenue[token] = 0;

        if (toReserve != 0) {
            IERC20(token).forceApprove(address(reserveVault), toReserve);
            reserveVault.contribute(token, toReserve);
        }
        if (toTreasury != 0) IERC20(token).safeTransfer(treasury, toTreasury);
        emit RevenueFlushed(token, toReserve, toTreasury);
    }

    // =============================================================================================
    // Admin
    // =============================================================================================

    function setTreasury(address treasury_) external onlyRole(Roles.DEFAULT_ADMIN_ROLE) {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }

    function setTimingParams(uint64 buybackWindow_, uint64 ripRevealTimeout_, uint16 poolStaleThresholdBps_)
        external
        onlyRole(Roles.DEFAULT_ADMIN_ROLE)
    {
        _setTimingParams(buybackWindow_, ripRevealTimeout_, poolStaleThresholdBps_);
    }

    /// @dev VRF gas-lane / callback tuning is pure ops. The coordinator address itself is part of the
    ///      fairness trust assumption, so changing it requires a Timelocked upgrade path.
    function setVRFOperationalConfig(bytes32 keyHash, uint32 callbackGasLimit, uint16 requestConfirmations)
        external
        onlyRole(Roles.OPERATIONS_ROLE)
    {
        _setVRFConfig(
            address(vrfCoordinator),
            vrfSubscriptionId,
            keyHash,
            callbackGasLimit,
            requestConfirmations,
            vrfNativePayment
        );
    }

    function setVRFCoordinator(address coordinator, uint256 subscriptionId, bool nativePayment)
        external
        onlyRole(Roles.DEFAULT_ADMIN_ROLE)
    {
        _setVRFConfig(
            coordinator, subscriptionId, vrfKeyHash, vrfCallbackGasLimit, vrfRequestConfirmations, nativePayment
        );
    }

    /// @notice Time-boxes a user's cash-out while their fiat payment is still reversible (§9).
    /// @dev Cannot block card delivery, redemption or refund — only the buyback path.
    function setBuybackLock(address user, uint64 until) external onlyRole(Roles.RISK_ADMIN_ROLE) {
        if (until > block.timestamp + MAX_BUYBACK_LOCK) revert LockTooLong();
        buybackLockedUntil[user] = until;
        emit BuybackLockSet(user, until, msg.sender);
    }

    function _setTimingParams(uint64 buybackWindow_, uint64 ripRevealTimeout_, uint16 poolStaleThresholdBps_)
        private
    {
        if (buybackWindow_ < MIN_BUYBACK_WINDOW || buybackWindow_ > MAX_BUYBACK_WINDOW) revert ParamOutOfRange();
        if (ripRevealTimeout_ < MIN_RIP_REVEAL_TIMEOUT || ripRevealTimeout_ > MAX_RIP_REVEAL_TIMEOUT) {
            revert ParamOutOfRange();
        }
        if (poolStaleThresholdBps_ > MAX_POOL_STALE_THRESHOLD_BPS) revert ParamOutOfRange();
        buybackWindow = buybackWindow_;
        ripRevealTimeout = ripRevealTimeout_;
        poolStaleThresholdBps = poolStaleThresholdBps_;
        emit TimingParamsUpdated(buybackWindow_, ripRevealTimeout_, poolStaleThresholdBps_);
    }

    // =============================================================================================
    // Verification helpers
    // =============================================================================================

    /// @dev The heart of the fairness claim. `packId`/`version` come from the stored draw, the leaf
    ///      slice must contain the VRF weight, and the leaf must be in the version's committed tree.
    ///      Since `commitPool` proved the leaves tile `[0, totalWeight)` exactly once, at most one
    ///      leaf can satisfy both conditions.
    function _verifyLeaf(bytes32 packId, uint256 version, uint256 winningWeight, LeafProof calldata p)
        private
        view
    {
        if (winningWeight < p.cumBefore || winningWeight >= p.cumBefore + p.weight) {
            revert WeightOutsideSlice(winningWeight, p.cumBefore, p.weight);
        }
        bytes32 leaf =
            PoolLib.leafHash(packId, version, p.leafIndex, p.tokenId, p.cumBefore, p.weight, p.priceRef);
        if (!MerkleProof.verifyCalldata(p.proof, poolVersions[packId][version].root, leaf)) revert BadMerkleProof();
    }

    function _consumeNonce(address user, uint256 nonce) private {
        uint256 expected = nonces[user];
        if (nonce != expected) revert InvalidNonce(nonce, expected);
        nonces[user] = expected + 1;
    }

    /// @dev `SignatureChecker` covers EOAs and ERC-1271 smart-contract wallets, and rejects the
    ///      `ecrecover == address(0)` degenerate case internally.
    function _requireSignature(address signer, bytes32 digest, bytes calldata signature) private view {
        if (signer == address(0)) revert InvalidSignature();
        if (!SignatureChecker.isValidSignatureNow(signer, digest, signature)) revert InvalidSignature();
    }

    /// @dev The oracle is authorised by ROLE, not by a stored address, so it must be recovered rather
    ///      than compared. `ECDSA.tryRecover` rejects malformed lengths, the `address(0)` degenerate
    ///      case and upper-half-order (malleable) `s` values, all of which a hand-rolled recover
    ///      routinely gets wrong.
    function _requireOracleSignature(bytes32 digest, bytes calldata signature) private view {
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        if (err != ECDSA.RecoverError.NoError || signer == address(0)) revert InvalidSignature();
        if (!hasRole(Roles.TRUSTED_ORACLE_ROLE, signer)) revert InvalidSignature();
    }

    function _purchaseAuthHash(PurchaseAuth calldata auth) private view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    PURCHASE_AUTH_TYPEHASH,
                    auth.user,
                    auth.packId,
                    auth.poolVersion,
                    auth.numRips,
                    auth.payToken,
                    auth.amountPerRip,
                    auth.nonce,
                    auth.deadline
                )
            )
        );
    }

    function _buybackHash(bytes32 typehash, BuybackAuth calldata auth) private view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(typehash, auth.drawId, auth.payToken, auth.payout, auth.nonce, auth.deadline))
        );
    }

    // =============================================================================================
    // Views
    // =============================================================================================

    function getDraw(uint256 drawId) external view returns (Draw memory) {
        return draws[drawId];
    }

    function getPoolVersion(bytes32 packId, uint256 version) external view returns (PoolLib.PoolVersion memory) {
        return poolVersions[packId][version];
    }

    /// @notice Number of committed leaves for a version (equal to `cardCount` once finalized).
    function poolLeafCount(bytes32 packId, uint256 version) external view returns (uint256) {
        return _poolLeafHashes[packId][version].length;
    }

    /// @notice The canonical leaf hash at `index`, for independent re-verification of a pool file.
    function poolLeafHash(bytes32 packId, uint256 version, uint256 index) external view returns (bytes32) {
        return _poolLeafHashes[packId][version][index];
    }

    function draftProgress(bytes32 packId, uint256 version)
        external
        view
        returns (bool started, uint32 leavesCommitted, uint256 cumCursor)
    {
        PoolLib.PoolDraft storage d = _drafts[packId][version];
        return (d.started, d.nextIndex, d.cumCursor);
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    uint256[50] private __gap;
}

// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {RoleGatedUpgradeable} from "./access/RoleGatedUpgradeable.sol";
import {Roles} from "./access/Roles.sol";
import {IReserveVault} from "./interfaces/IReserveVault.sol";

/// @title ReserveVault
/// @notice Segregated buyback pool with real liability accounting and public proof-of-reserves
///         (spec §5.5). This is the contract that turns "we'll buy your card back" from a promise
///         into a funded, on-chain obligation.
///
/// The core invariant (spec §7.1.1), asserted at the end of every state-changing function:
///
///     balanceOf(this, token) >= reservedLiabilities[token]
///
/// combined with `GachaMachine` booking a reservation *before* the user is ever told a buyback exists.
/// Consequences an auditor should verify:
///  - `rip` reverts when the reserve cannot back the new obligation → we cannot sell a pack whose
///    buyback we cannot pay;
///  - `withdrawSurplus` can only take value strictly above obligations *plus a buffer*, and only
///    through the 48h Timelock → the reserve is not an operator piggy bank;
///  - `payFromReservation` is rate-limited per epoch → even a fully compromised oracle + buyback key
///    pair cannot drain more than one epoch's cap before the pause lands.
contract ReserveVault is RoleGatedUpgradeable, IReserveVault {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;

    /// @notice Outstanding, funded buyback obligations per token.
    mapping(address token => uint256) public reservedLiabilities;

    /// @notice Lifetime funded-in, for reconciliation against the indexer's ledger.
    mapping(address token => uint256) public totalDeposited;

    /// @notice Lifetime paid-out to users.
    mapping(address token => uint256) public totalPaid;

    /// @notice Per-epoch buyback outflow ceiling. ZERO MEANS NO OUTFLOW ALLOWED (fail closed).
    mapping(address token => uint256) public maxBuybackOutflowPerEpoch;

    /// @notice Outflow already spent in `currentEpoch[token]`.
    mapping(address token => uint256) public epochOutflow;

    /// @notice Epoch index (`block.timestamp / epochDuration`) that `epochOutflow` refers to.
    mapping(address token => uint256) public currentEpoch;

    /// @notice Length of a rate-limit epoch.
    uint64 public epochDuration;

    /// @notice Extra headroom `withdrawSurplus` must leave above obligations.
    uint16 public surplusBufferBps;

    uint16 public constant MIN_SURPLUS_BUFFER_BPS = 500; // 5%
    uint16 public constant MAX_SURPLUS_BUFFER_BPS = 5000; // 50%
    uint64 public constant MIN_EPOCH_DURATION = 1 hours;
    uint64 public constant MAX_EPOCH_DURATION = 30 days;

    error InsufficientReserve(address token, uint256 balance, uint256 required);
    error OutflowCapExceeded(address token, uint256 requested, uint256 remaining);
    error OutflowCapNotConfigured(address token);
    error PayoutExceedsReservation(uint256 payout, uint256 reserved);
    error SurplusBufferOutOfRange(uint16 bps);
    error EpochDurationOutOfRange(uint64 duration);
    error ZeroAmount();

    event Funded(address indexed token, address indexed from, uint256 amount, uint256 newBalance);
    event Reserved(address indexed token, uint256 amount, uint256 totalReserved);
    event Unreserved(address indexed token, uint256 amount, uint256 totalReserved);
    event Paid(address indexed token, address indexed to, uint256 amount, uint256 releasedRemainder);
    event SurplusWithdrawn(address indexed token, address indexed to, uint256 amount, address by);
    event MaxBuybackOutflowUpdated(address indexed token, uint256 amount);
    event EpochDurationUpdated(uint64 duration);
    event SurplusBufferUpdated(uint16 bps);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address accessController_, uint64 epochDuration_, uint16 surplusBufferBps_)
        external
        initializer
    {
        __RoleGated_init(accessController_);
        _setEpochDuration(epochDuration_);
        _setSurplusBuffer(surplusBufferBps_);
    }

    // ---------------------------------------------------------------------------------------------
    // Funding
    // ---------------------------------------------------------------------------------------------

    /// @notice Treasury tops up the reserve. Instant and never pausable — an under-funded reserve
    ///         blocks every `rip`, so making solvency wait 48 hours would be an outage, not a control.
    ///         TREASURER_ROLE can ONLY do this; taking value out is Timelocked (see {withdrawSurplus}).
    function fund(address token, uint256 amount) external nonReentrant onlyRole(Roles.TREASURER_ROLE) {
        _pullAndBook(token, amount);
    }

    /// @notice The GachaMachine routes its committed share of rip revenue here at resolution time,
    ///         so the reserve is fed by the product itself and not only by manual top-ups.
    function contribute(address token, uint256 amount) external nonReentrant onlyRole(Roles.GACHA_ROLE) {
        _pullAndBook(token, amount);
    }

    function _pullAndBook(address token, uint256 amount) private {
        if (amount == 0) revert ZeroAmount();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        totalDeposited[token] += amount;
        emit Funded(token, msg.sender, amount, IERC20(token).balanceOf(address(this)));
    }

    // ---------------------------------------------------------------------------------------------
    // Liability lifecycle (GachaMachine only)
    // ---------------------------------------------------------------------------------------------

    /// @inheritdoc IReserveVault
    /// @dev Pausable on purpose: pausing the reserve is how an incident stops new rips being sold
    ///      (`rip` reverts when it cannot reserve) without touching anyone's existing obligation.
    function reserve(address token, uint256 amount)
        external
        nonReentrant
        whenNotPaused
        onlyRole(Roles.GACHA_ROLE)
    {
        if (amount == 0) revert ZeroAmount();
        uint256 newTotal = reservedLiabilities[token] + amount;
        reservedLiabilities[token] = newTotal;
        _requireSolvent(token, newTotal);
        emit Reserved(token, amount, newTotal);
    }

    /// @inheritdoc IReserveVault
    /// @dev NOT pausable: releasing an obligation happens on the delivery path, which must keep
    ///      working while paused so `claimAfterTimeout` can always hand a user their card.
    function unreserve(address token, uint256 amount) external nonReentrant onlyRole(Roles.GACHA_ROLE) {
        // Checked arithmetic: an underflow here would mean the GachaMachine double-released a
        // reservation, so reverting is the correct, loud failure.
        uint256 newTotal = reservedLiabilities[token] - amount;
        reservedLiabilities[token] = newTotal;
        emit Unreserved(token, amount, newTotal);
    }

    /// @inheritdoc IReserveVault
    /// @dev Combines the spec's `pay` + `releaseRemainder` into one atomic call so the vault is never
    ///      observable in a state where a paid-out draw still carries its full reservation.
    function payFromReservation(address token, address to, uint256 amount, uint256 reservedAmount)
        external
        nonReentrant
        whenNotPaused
        onlyRole(Roles.GACHA_ROLE)
    {
        if (amount == 0) revert ZeroAmount();
        if (amount > reservedAmount) revert PayoutExceedsReservation(amount, reservedAmount);

        _consumeOutflowAllowance(token, amount);

        uint256 newTotal = reservedLiabilities[token] - reservedAmount;
        reservedLiabilities[token] = newTotal;
        totalPaid[token] += amount;

        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance < amount) revert InsufficientReserve(token, balance, amount);

        emit Paid(token, to, amount, reservedAmount - amount);
        IERC20(token).safeTransfer(to, amount);

        _requireSolvent(token, newTotal);
    }

    // ---------------------------------------------------------------------------------------------
    // Treasury
    // ---------------------------------------------------------------------------------------------

    /// @notice Withdraws only value above obligations plus `surplusBufferBps` headroom.
    ///
    /// @dev Gated on DEFAULT_ADMIN_ROLE — which is held ONLY by the TimelockController — rather than on
    ///      TREASURER_ROLE. This is deliberate and load-bearing.
    ///
    ///      The spec calls for `fund` to be instant and `withdrawSurplus` to be Timelocked. If both
    ///      sat on TREASURER_ROLE that would be unachievable: whoever holds the role to top the reserve
    ///      up at 3am could equally drain its surplus with the same key, and "via Timelock" would be a
    ///      procedure rather than a property. Splitting the gate by FUNCTION rather than by role makes
    ///      the 48h delay structural — there is no key that can skip it.
    function withdrawSurplus(address token, uint256 amount, address to)
        external
        nonReentrant
        whenNotPaused
        onlyRole(Roles.DEFAULT_ADMIN_ROLE)
    {
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();

        uint256 balance = IERC20(token).balanceOf(address(this));
        uint256 required = reservedLiabilities[token] * (BPS + surplusBufferBps) / BPS;
        if (balance < amount || balance - amount < required) {
            revert InsufficientReserve(token, balance, amount + required);
        }

        emit SurplusWithdrawn(token, to, amount, msg.sender);
        IERC20(token).safeTransfer(to, amount);
        _requireSolvent(token, reservedLiabilities[token]);
    }

    /// @dev Timelocked for the same reason as {withdrawSurplus}: raising the epoch cap is the first
    ///      move anyone draining the reserve would make, so it must not be reachable by a hot key.
    function setMaxBuybackOutflow(address token, uint256 amount) external onlyRole(Roles.DEFAULT_ADMIN_ROLE) {
        maxBuybackOutflowPerEpoch[token] = amount;
        emit MaxBuybackOutflowUpdated(token, amount);
    }

    function setEpochDuration(uint64 duration) external onlyRole(Roles.DEFAULT_ADMIN_ROLE) {
        _setEpochDuration(duration);
    }

    function setSurplusBufferBps(uint16 bps) external onlyRole(Roles.DEFAULT_ADMIN_ROLE) {
        _setSurplusBuffer(bps);
    }

    // ---------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------

    /// @inheritdoc IReserveVault
    /// @dev `reserved` covers every unsettled in-window draw, so the public dashboard cannot show
    ///      false comfort by ignoring obligations that have not been exercised yet (FIX L4-fair).
    function proofOfReserves(address token)
        external
        view
        returns (uint256 balance, uint256 reserved, int256 surplus)
    {
        balance = IERC20(token).balanceOf(address(this));
        reserved = reservedLiabilities[token];
        surplus = SafeCast.toInt256(balance) - SafeCast.toInt256(reserved);
    }

    /// @notice Remaining buyback outflow allowance in the current epoch.
    function outflowRemaining(address token) external view returns (uint256) {
        uint256 cap = maxBuybackOutflowPerEpoch[token];
        if (_epochIndex() != currentEpoch[token]) return cap;
        uint256 spent = epochOutflow[token];
        return spent >= cap ? 0 : cap - spent;
    }

    function epochIndex() external view returns (uint256) {
        return _epochIndex();
    }

    // ---------------------------------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------------------------------

    function _requireSolvent(address token, uint256 liabilities) private view {
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance < liabilities) revert InsufficientReserve(token, balance, liabilities);
    }

    function _epochIndex() private view returns (uint256) {
        return block.timestamp / epochDuration;
    }

    function _consumeOutflowAllowance(address token, uint256 amount) private {
        uint256 cap = maxBuybackOutflowPerEpoch[token];
        if (cap == 0) revert OutflowCapNotConfigured(token);

        uint256 epoch = _epochIndex();
        uint256 spent = currentEpoch[token] == epoch ? epochOutflow[token] : 0;
        if (spent + amount > cap) revert OutflowCapExceeded(token, amount, cap - spent);

        currentEpoch[token] = epoch;
        epochOutflow[token] = spent + amount;
    }

    function _setEpochDuration(uint64 duration) private {
        if (duration < MIN_EPOCH_DURATION || duration > MAX_EPOCH_DURATION) {
            revert EpochDurationOutOfRange(duration);
        }
        epochDuration = duration;
        emit EpochDurationUpdated(duration);
    }

    function _setSurplusBuffer(uint16 bps) private {
        if (bps < MIN_SURPLUS_BUFFER_BPS || bps > MAX_SURPLUS_BUFFER_BPS) revert SurplusBufferOutOfRange(bps);
        surplusBufferBps = bps;
        emit SurplusBufferUpdated(bps);
    }

    uint256[50] private __gap;
}

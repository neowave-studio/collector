// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {RoleGatedUpgradeable} from "./access/RoleGatedUpgradeable.sol";
import {Roles} from "./access/Roles.sol";
import {IPaymentRouter} from "./interfaces/IPaymentRouter.sol";
import {IPermit2} from "./interfaces/IPermit2.sol";

/// @title PaymentRouter
/// @notice Pulls user funds for rips and marketplace fills, and owns the per-chain pay-token
///         allowlist (spec §5.4).
///
/// Two pull modes, both bounded by the user's own signature:
///  - **Permit2 (preferred).** `permitWitnessTransferFrom` with a witness that binds the exact rip
///    (or order) being paid for, so a pulled signature cannot be redirected to a different purchase.
///  - **Allowance fallback.** Used only where Permit2 is not deployed — new EVM chains such as
///    Robinhood Chain ship without it. Safe because `collect*` is restricted to
///    PAYMENT_CONSUMER_ROLE (GachaMachine / Marketplace), each of which has already verified an
///    EIP-712 authorization from `from` that pins token, amount and purpose. The allowance is a
///    capability the user grants to this router, not an authority the relayer holds.
///
/// Allowlist policy (spec §5.4): standard ERC-20s only. Fee-on-transfer and rebasing tokens are
/// forbidden — they break the ReserveVault's per-token liability accounting, since `reserve()`
/// assumes the amount booked is the amount that will still be there later.
contract PaymentRouter is RoleGatedUpgradeable, IPaymentRouter {
    using SafeERC20 for IERC20;

    bytes32 public constant RIP_WITNESS_TYPEHASH =
        keccak256("RipWitness(bytes32 packId,uint256 poolVersion,uint96 numRips,address user)");
    bytes32 public constant ORDER_WITNESS_TYPEHASH = keccak256("OrderWitness(bytes32 orderHash)");

    string private constant RIP_WITNESS_TYPE_STRING =
        "RipWitness witness)RipWitness(bytes32 packId,uint256 poolVersion,uint96 numRips,address user)TokenPermissions(address token,uint256 amount)";
    string private constant ORDER_WITNESS_TYPE_STRING =
        "OrderWitness witness)OrderWitness(bytes32 orderHash)TokenPermissions(address token,uint256 amount)";

    /// @notice Uniswap Permit2. `address(0)` disables the witness path on chains without it.
    IPermit2 public permit2;

    /// @inheritdoc IPaymentRouter
    mapping(address token => bool) public isAllowedPayToken;

    error TokenNotAllowed(address token);
    error ZeroAmount();

    event PayTokenAllowed(address indexed token, bool allowed);
    event Permit2Updated(address indexed permit2);
    event Collected(address indexed from, address indexed token, address indexed to, uint256 amount, bool viaPermit2);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address accessController_, address permit2_) external initializer {
        __RoleGated_init(accessController_);
        permit2 = IPermit2(permit2_); // may legitimately be address(0)
        emit Permit2Updated(permit2_);
    }

    // ---------------------------------------------------------------------------------------------
    // Allowlist
    // ---------------------------------------------------------------------------------------------

    /// @dev TOKEN_ADMIN_ROLE is held by the Safe and exercised through the 48h Timelock (spec §6.2):
    ///      adding a pay token is a change to the system's trust assumptions, not an ops tweak.
    function setAllowedPayToken(address token, bool allowed) external onlyRole(Roles.TOKEN_ADMIN_ROLE) {
        if (token == address(0)) revert ZeroAddress();
        isAllowedPayToken[token] = allowed;
        emit PayTokenAllowed(token, allowed);
    }

    function setPermit2(address permit2_) external onlyRole(Roles.DEFAULT_ADMIN_ROLE) {
        permit2 = IPermit2(permit2_);
        emit Permit2Updated(permit2_);
    }

    /// @inheritdoc IPaymentRouter
    function requireAllowedPayToken(address token) public view {
        if (!isAllowedPayToken[token]) revert TokenNotAllowed(token);
    }

    // ---------------------------------------------------------------------------------------------
    // Pulls
    // ---------------------------------------------------------------------------------------------

    /// @inheritdoc IPaymentRouter
    function collectForRip(
        address from,
        address token,
        uint256 amount,
        address to,
        bytes32 packId,
        uint256 poolVersion,
        uint96 numRips,
        PaymentPermit calldata payment
    ) external nonReentrant whenNotPaused onlyRole(Roles.PAYMENT_CONSUMER_ROLE) {
        bytes32 witness = keccak256(abi.encode(RIP_WITNESS_TYPEHASH, packId, poolVersion, numRips, from));
        _collect(from, token, amount, to, witness, RIP_WITNESS_TYPE_STRING, payment);
    }

    /// @inheritdoc IPaymentRouter
    function collectForOrder(
        address from,
        address token,
        uint256 amount,
        address to,
        bytes32 orderHash,
        PaymentPermit calldata payment
    ) external nonReentrant whenNotPaused onlyRole(Roles.PAYMENT_CONSUMER_ROLE) {
        bytes32 witness = keccak256(abi.encode(ORDER_WITNESS_TYPEHASH, orderHash));
        _collect(from, token, amount, to, witness, ORDER_WITNESS_TYPE_STRING, payment);
    }

    function _collect(
        address from,
        address token,
        uint256 amount,
        address to,
        bytes32 witness,
        string memory witnessTypeString,
        PaymentPermit calldata payment
    ) private {
        if (amount == 0) revert ZeroAmount();
        requireAllowedPayToken(token);

        bool viaPermit2 = payment.signature.length != 0 && address(permit2) != address(0);
        if (viaPermit2) {
            permit2.permitWitnessTransferFrom(
                IPermit2.PermitTransferFrom({
                    permitted: IPermit2.TokenPermissions({token: token, amount: amount}),
                    nonce: payment.nonce,
                    deadline: payment.deadline
                }),
                IPermit2.SignatureTransferDetails({to: to, requestedAmount: amount}),
                from,
                witness,
                witnessTypeString,
                payment.signature
            );
        } else {
            IERC20(token).safeTransferFrom(from, to, amount);
        }
        emit Collected(from, token, to, amount, viaPermit2);
    }

    uint256[50] private __gap;
}

// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IAccessController} from "./IAccessController.sol";
import {Roles} from "./Roles.sol";

/// @title RoleGatedUpgradeable
/// @notice Standard base for every upgradeable contract in the suite (spec §4 "Standard base").
///         Initializable (+`_disableInitializers()` in each constructor) · UUPS · Pausable ·
///         ReentrancyGuard · roles LIVE-READ from AccessController · trailing storage gap.
///
/// @dev `accessController` is written once at initialization and has no setter. Repointing the role
///      store therefore requires a full UUPS upgrade — i.e. Safe + 48h Timelock.
abstract contract RoleGatedUpgradeable is
    Initializable,
    UUPSUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable
{
    /// @notice The single central role store. Never cached beyond this pointer.
    IAccessController public accessController;

    error ZeroAddress();

    event PausedBy(address indexed account);
    event UnpausedBy(address indexed account);

    /// @dev Reverts unless `msg.sender` currently holds `role` in the AccessController.
    modifier onlyRole(bytes32 role) {
        accessController.checkRole(role, msg.sender);
        _;
    }

    function __RoleGated_init(address accessController_) internal onlyInitializing {
        if (accessController_ == address(0)) revert ZeroAddress();
        __UUPSUpgradeable_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        accessController = IAccessController(accessController_);
    }

    function hasRole(bytes32 role, address account) public view returns (bool) {
        return accessController.hasRole(role, account);
    }

    /// @notice Emergency stop. Instant by design (spec §6.2) — an ops multisig must be able to
    ///         halt inflows during an incident without waiting 48h.
    /// @dev The user escape hatches (`claimAfterTimeout`, `refundStuckRip`, `claimUnavailable`) are
    ///      deliberately NOT `whenNotPaused`: pausing must never strand a paid user.
    function pause() external onlyRole(Roles.PAUSE_ADMIN_ROLE) {
        _pause();
        emit PausedBy(msg.sender);
    }

    function unpause() external onlyRole(Roles.PAUSE_ADMIN_ROLE) {
        _unpause();
        emit UnpausedBy(msg.sender);
    }

    /// @dev DEFAULT_ADMIN_ROLE is held only by the Timelock (proposer = Safe): multisig + 48h delay.
    function _authorizeUpgrade(address) internal override onlyRole(Roles.DEFAULT_ADMIN_ROLE) {}

    uint256[49] private __gap;
}

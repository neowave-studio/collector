// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {AccessControlEnumerableUpgradeable} from
    "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlEnumerableUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Roles} from "./Roles.sol";
import {IAccessController} from "./IAccessController.sol";

/// @title AccessController
/// @notice The single central role store for the Collector suite (spec §4 / FIX M1-sec).
///
/// Design notes an auditor should check:
///  - Exactly ONE role model exists. Consumers hold a pointer to this contract and live-read it
///    (`RoleGatedUpgradeable`); nothing is cached, so revocation is instant everywhere.
///  - `DEFAULT_ADMIN_ROLE` is held ONLY by the TimelockController (proposer = Safe). Therefore every
///    role grant/revoke that is *not* explicitly delegated below inherits multisig + 48h delay.
///  - Operational keys (relayer / oracle / buyback) are delegated to `OPERATIONS_ROLE` so a suspected
///    compromise can be rotated in one transaction (spec §6.2 "instant; bounded blast radius").
///  - Its own `upgradeToAndCall` is Timelock+Safe gated and it is inside the storage-layout CI gate.
///  - The last `DEFAULT_ADMIN_ROLE` holder can never be removed: losing it would brick every
///    timelocked path (upgrades, treasury, allowlist) with no recovery.
contract AccessController is AccessControlEnumerableUpgradeable, UUPSUpgradeable, IAccessController {
    error LastAdminCannotBeRemoved();
    error ZeroAddress();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @param timelock The TimelockController. Receives DEFAULT_ADMIN_ROLE — never an EOA.
    /// @param opsMultisig Ops multisig / KMS principal that may rotate operational keys.
    function initialize(address timelock, address opsMultisig) external initializer {
        if (timelock == address(0) || opsMultisig == address(0)) revert ZeroAddress();
        __AccessControlEnumerable_init();
        __UUPSUpgradeable_init();

        _grantRole(Roles.DEFAULT_ADMIN_ROLE, timelock);
        _grantRole(Roles.OPERATIONS_ROLE, opsMultisig);

        // Delegate ONLY the hot operational keys to OPERATIONS_ROLE (fast rotation on suspicion).
        // Everything else keeps DEFAULT_ADMIN_ROLE (= Timelock) as its role admin.
        _setRoleAdmin(Roles.TRUSTED_RELAYER_ROLE, Roles.OPERATIONS_ROLE);
        _setRoleAdmin(Roles.TRUSTED_ORACLE_ROLE, Roles.OPERATIONS_ROLE);
        _setRoleAdmin(Roles.TRUSTED_BUYBACK_ROLE, Roles.OPERATIONS_ROLE);
    }

    /// @inheritdoc IAccessController
    function checkRole(bytes32 role, address account) external view {
        _checkRole(role, account);
    }

    function hasRole(bytes32 role, address account)
        public
        view
        override(AccessControlUpgradeable, IAccessControl, IAccessController)
        returns (bool)
    {
        return super.hasRole(role, account);
    }

    /// @dev Guards against bricking the suite by removing the final admin (which is the Timelock).
    function _revokeRole(bytes32 role, address account) internal override returns (bool) {
        if (role == Roles.DEFAULT_ADMIN_ROLE && getRoleMemberCount(Roles.DEFAULT_ADMIN_ROLE) == 1) {
            revert LastAdminCannotBeRemoved();
        }
        return super._revokeRole(role, account);
    }

    /// @dev Upgrading the role store itself is the highest-privilege action in the system:
    ///      multisig proposal + 48h public Timelock delay (spec §6.4).
    function _authorizeUpgrade(address) internal override onlyRole(Roles.DEFAULT_ADMIN_ROLE) {}

    uint256[50] private __gap;
}

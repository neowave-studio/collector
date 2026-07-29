// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

/// @title IAccessController
/// @notice The single central role store for the suite. Every consumer LIVE-READS it and caches nothing
///         (spec §4, FIX M1-sec), so a role revocation takes effect everywhere in the same block.
interface IAccessController {
    function hasRole(bytes32 role, address account) external view returns (bool);

    /// @notice Reverts with `AccessControlUnauthorizedAccount` if `account` does not hold `role`.
    function checkRole(bytes32 role, address account) external view;
}

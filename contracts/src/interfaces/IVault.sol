// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

interface IVault {
    /// @notice True while the Vault custodies `tokenId`.
    function isHeld(uint256 tokenId) external view returns (bool);

    /// @notice The pack a deposited token is earmarked for. `bytes32(0)` = unassigned.
    function tokenPack(uint256 tokenId) external view returns (bytes32);

    /// @notice Reverts unless every tokenId is held AND earmarked for `packId` (spec §5.2 FIX H5-sec).
    function requirePoolMembership(bytes32 packId, uint256[] calldata tokenIds) external view;

    /// @notice The ONLY user-facing exit from inventory. Restricted to SETTLEMENT_ROLE (= GachaMachine).
    function releaseTo(address to, uint256 tokenId, bytes32 packId) external;
}

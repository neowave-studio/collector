// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

interface IReserveVault {
    /// @notice Books a new obligation. Reverts if the balance cannot cover total liabilities after.
    function reserve(address token, uint256 amount) external;

    /// @notice Releases an obligation that will never be paid (card delivered, or window lapsed).
    function unreserve(address token, uint256 amount) external;

    /// @notice Pays a user out of an already-reserved obligation and decrements liabilities by the
    ///         full `reservedAmount`, refunding `reservedAmount - amount` back to free surplus.
    function payFromReservation(address token, address to, uint256 amount, uint256 reservedAmount) external;

    /// @notice Adds rip revenue to the reserve. Restricted to GACHA_ROLE.
    function contribute(address token, uint256 amount) external;

    function reservedLiabilities(address token) external view returns (uint256);

    function proofOfReserves(address token)
        external
        view
        returns (uint256 balance, uint256 reserved, int256 surplus);
}

// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

interface IPaymentRouter {
    /// @notice How a consumer contract should pull `from`'s funds.
    /// @param nonce Permit2 unordered nonce. Ignored on the allowance path.
    /// @param deadline Permit2 signature deadline. Ignored on the allowance path.
    /// @param signature The user's Permit2 signature. EMPTY = use the plain ERC-20 allowance path
    ///        (for chains where Permit2 is not deployed).
    struct PaymentPermit {
        uint256 nonce;
        uint256 deadline;
        bytes signature;
    }

    /// @notice True if `token` is on the per-chain pay-token allowlist.
    function isAllowedPayToken(address token) external view returns (bool);

    /// @notice Reverts unless `token` is allowlisted.
    function requireAllowedPayToken(address token) external view;

    /// @notice Pulls `amount` of `token` from `from` to `to`, binding the rip parameters into the
    ///         Permit2 witness so the pulled funds can only ever pay for the rip the user signed.
    function collectForRip(
        address from,
        address token,
        uint256 amount,
        address to,
        bytes32 packId,
        uint256 poolVersion,
        uint96 numRips,
        PaymentPermit calldata payment
    ) external;

    /// @notice Pulls `amount` of `token` from `from` to `to` for a marketplace fill.
    function collectForOrder(
        address from,
        address token,
        uint256 amount,
        address to,
        bytes32 orderHash,
        PaymentPermit calldata payment
    ) external;
}

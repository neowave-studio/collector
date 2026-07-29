// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Subset of Uniswap Permit2 `ISignatureTransfer` used by `PaymentRouter`.
/// @dev Canonical deployment (same address on every chain it exists on):
///      0x000000000022D473030F116dDEE9F6B43aC78BA3. On chains where Permit2 is not deployed,
///      `PaymentRouter` is configured with `permit2 == address(0)` and falls back to a plain
///      allowance pull — safe because the charged amount is always bounded by the user's own
///      EIP-712 `PurchaseAuth` / `Order` signature, never by the relayer.
interface IPermit2 {
    struct TokenPermissions {
        address token;
        uint256 amount;
    }

    struct PermitTransferFrom {
        TokenPermissions permitted;
        uint256 nonce;
        uint256 deadline;
    }

    struct SignatureTransferDetails {
        address to;
        uint256 requestedAmount;
    }

    function permitWitnessTransferFrom(
        PermitTransferFrom calldata permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes32 witness,
        string calldata witnessTypeString,
        bytes calldata signature
    ) external;

    function DOMAIN_SEPARATOR() external view returns (bytes32);
}

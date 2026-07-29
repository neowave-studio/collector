// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Minimal local copy of the Chainlink VRF v2.5 request types and coordinator surface we use.
/// @dev Vendored deliberately: `@chainlink/contracts` pins its own OZ version and its consumer base is
///      constructor-based (not upgradeable-safe). Encoding is byte-identical to
///      `VRFV2PlusClient` / `IVRFCoordinatorV2Plus`, pinned by `test/unit/VRFEncoding.t.sol`.
library VRFV2PlusClient {
    bytes4 public constant EXTRA_ARGS_V1_TAG = bytes4(keccak256("VRF ExtraArgsV1"));

    struct ExtraArgsV1 {
        bool nativePayment;
    }

    struct RandomWordsRequest {
        bytes32 keyHash;
        uint256 subId;
        uint16 requestConfirmations;
        uint32 callbackGasLimit;
        uint32 numWords;
        bytes extraArgs;
    }

    function _argsToBytes(ExtraArgsV1 memory extraArgs) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(EXTRA_ARGS_V1_TAG, extraArgs);
    }
}

interface IVRFCoordinatorV2Plus {
    function requestRandomWords(VRFV2PlusClient.RandomWordsRequest calldata req)
        external
        returns (uint256 requestId);
}

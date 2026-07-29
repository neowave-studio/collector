// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {IVRFCoordinatorV2Plus, VRFV2PlusClient} from "./IVRFCoordinatorV2Plus.sol";

/// @title VRFConsumerV2PlusUpgradeable
/// @notice Upgradeable Chainlink VRF v2.5 consumer base.
/// @dev Chainlink's own `VRFConsumerBaseV2Plus` stores the coordinator in an immutable set by the
///      constructor, which is incompatible with a proxy. This is the same logic with initializer-set
///      storage and a trailing gap.
abstract contract VRFConsumerV2PlusUpgradeable {
    /// @notice Chainlink VRF v2.5 coordinator. Only this address may deliver randomness.
    IVRFCoordinatorV2Plus public vrfCoordinator;

    /// @notice VRF subscription that pays for requests.
    uint256 public vrfSubscriptionId;

    /// @notice Gas lane key hash.
    bytes32 public vrfKeyHash;

    /// @notice Gas allotted to `rawFulfillRandomWords`. Must cover the reveal loop for MAX_RIPS_PER_TX.
    uint32 public vrfCallbackGasLimit;

    /// @notice Block confirmations the coordinator waits before responding.
    uint16 public vrfRequestConfirmations;

    /// @notice True pays the subscription in native gas token, false in LINK.
    bool public vrfNativePayment;

    error OnlyVRFCoordinator(address caller);
    error VRFNotConfigured();

    event VRFConfigUpdated(
        address indexed coordinator,
        uint256 subscriptionId,
        bytes32 keyHash,
        uint32 callbackGasLimit,
        uint16 requestConfirmations,
        bool nativePayment
    );

    function __VRFConsumer_init(
        address coordinator,
        uint256 subscriptionId,
        bytes32 keyHash,
        uint32 callbackGasLimit,
        uint16 requestConfirmations,
        bool nativePayment
    ) internal {
        _setVRFConfig(coordinator, subscriptionId, keyHash, callbackGasLimit, requestConfirmations, nativePayment);
    }

    function _setVRFConfig(
        address coordinator,
        uint256 subscriptionId,
        bytes32 keyHash,
        uint32 callbackGasLimit,
        uint16 requestConfirmations,
        bool nativePayment
    ) internal {
        // A zero coordinator or key hash would make `rip` unusable; a zero callback gas limit would
        // make every reveal fail. Fail loudly at configuration time instead.
        if (coordinator == address(0) || keyHash == bytes32(0) || callbackGasLimit == 0) revert VRFNotConfigured();
        vrfCoordinator = IVRFCoordinatorV2Plus(coordinator);
        vrfSubscriptionId = subscriptionId;
        vrfKeyHash = keyHash;
        vrfCallbackGasLimit = callbackGasLimit;
        vrfRequestConfirmations = requestConfirmations;
        vrfNativePayment = nativePayment;
        emit VRFConfigUpdated(
            coordinator, subscriptionId, keyHash, callbackGasLimit, requestConfirmations, nativePayment
        );
    }

    function _requestRandomWords(uint32 numWords) internal returns (uint256 requestId) {
        return vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: vrfKeyHash,
                subId: vrfSubscriptionId,
                requestConfirmations: vrfRequestConfirmations,
                callbackGasLimit: vrfCallbackGasLimit,
                numWords: numWords,
                extraArgs: VRFV2PlusClient._argsToBytes(VRFV2PlusClient.ExtraArgsV1({nativePayment: vrfNativePayment}))
            })
        );
    }

    /// @notice Entry point used by the coordinator. Never callable by anyone else.
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external {
        if (msg.sender != address(vrfCoordinator)) revert OnlyVRFCoordinator(msg.sender);
        _fulfillRandomWords(requestId, randomWords);
    }

    function _fulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) internal virtual;

    uint256[44] private __gap;
}

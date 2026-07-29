// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IVRFCoordinatorV2Plus, VRFV2PlusClient} from "../../src/vrf/IVRFCoordinatorV2Plus.sol";

interface IRawFulfill {
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external;
}

/// @notice Stand-in for the Chainlink VRF v2.5 coordinator.
/// @dev Records what was requested so tests can assert the request parameters, and lets the test
///      choose exactly which words come back — including the adversarial cases (wrong count, a word
///      that lands on a specific slice, a second delivery for the same request).
contract MockVRFCoordinator is IVRFCoordinatorV2Plus {
    uint256 public nextRequestId = 1;

    mapping(uint256 requestId => address) public consumerOf;
    mapping(uint256 requestId => uint32) public numWordsOf;
    mapping(uint256 requestId => bytes32) public keyHashOf;
    mapping(uint256 requestId => uint32) public callbackGasLimitOf;
    mapping(uint256 requestId => bytes) public extraArgsOf;

    function requestRandomWords(VRFV2PlusClient.RandomWordsRequest calldata req)
        external
        returns (uint256 requestId)
    {
        requestId = nextRequestId++;
        consumerOf[requestId] = msg.sender;
        numWordsOf[requestId] = req.numWords;
        keyHashOf[requestId] = req.keyHash;
        callbackGasLimitOf[requestId] = req.callbackGasLimit;
        extraArgsOf[requestId] = req.extraArgs;
    }

    function fulfill(uint256 requestId, uint256[] memory words) public {
        IRawFulfill(consumerOf[requestId]).rawFulfillRandomWords(requestId, words);
    }

    function fulfillOne(uint256 requestId, uint256 word) external {
        uint256[] memory words = new uint256[](1);
        words[0] = word;
        fulfill(requestId, words);
    }
}

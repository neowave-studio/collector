// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IVRFCoordinatorV2Plus, VRFV2PlusClient} from "../../src/vrf/IVRFCoordinatorV2Plus.sol";
import {VRFConsumerV2PlusUpgradeable} from "../../src/vrf/VRFConsumerV2PlusUpgradeable.sol";

/// @notice Pins the vendored VRF v2.5 types to Chainlink's real wire format.
///
/// `src/vrf/` is a hand-copied subset of the official Chainlink contracts package, vendored because
/// their consumer base sets the coordinator in a constructor and so cannot sit behind a proxy. That copy is
/// the entire integration: if a field order, a selector or the extraArgs tag drifts from the real
/// coordinator's ABI, every `rip` on mainnet reverts — or worse, encodes to something the coordinator
/// accepts but misreads, and the request silently never returns.
///
/// The unit tests elsewhere cannot catch that, because they talk to our own mock, which shares the
/// same vendored types and would drift with them. So these assertions are deliberately written
/// against literal constants taken from Chainlink's published v2.5 contracts rather than against
/// anything in this repository. If Chainlink changes the ABI, these fail and the vendored copy is
/// updated; nothing here should be "fixed" by re-deriving a constant from our own source.
contract VRFEncodingTest is Test {
    /// @dev `bytes4(keccak256("VRF ExtraArgsV1"))` as published in Chainlink's VRFV2PlusClient.
    bytes4 internal constant CHAINLINK_EXTRA_ARGS_V1_TAG = 0x92fd1338;

    /// @dev Selector of `requestRandomWords((bytes32,uint256,uint16,uint32,uint32,bytes))` on the
    ///      live VRF v2.5 coordinator. Field order is load-bearing: the tuple is encoded positionally.
    bytes4 internal constant CHAINLINK_REQUEST_SELECTOR = 0x9b1c385e;

    /// @dev Selector the coordinator calls back with. Unchanged from VRF v2.
    bytes4 internal constant CHAINLINK_RAW_FULFILL_SELECTOR = 0x1fe543e3;

    function test_extraArgsTagMatchesChainlink() public pure {
        assertEq(
            VRFV2PlusClient.EXTRA_ARGS_V1_TAG,
            CHAINLINK_EXTRA_ARGS_V1_TAG,
            "extraArgs tag drifted from Chainlink VRFV2PlusClient"
        );
    }

    function test_requestSelectorMatchesChainlink() public pure {
        assertEq(
            IVRFCoordinatorV2Plus.requestRandomWords.selector,
            CHAINLINK_REQUEST_SELECTOR,
            "requestRandomWords selector drifted: the coordinator will not recognise our call"
        );
    }

    function test_rawFulfillSelectorMatchesChainlink() public pure {
        assertEq(
            VRFConsumerV2PlusUpgradeable.rawFulfillRandomWords.selector,
            CHAINLINK_RAW_FULFILL_SELECTOR,
            "rawFulfillRandomWords selector drifted: the coordinator's callback will not reach us"
        );
    }

    /// @dev The tuple is encoded positionally, so a reordered struct still compiles and still passes
    ///      every test that only round-trips through our own types. Compare against bytes written out
    ///      by hand instead.
    function test_requestEncodesToChainlinkLayout() public pure {
        VRFV2PlusClient.RandomWordsRequest memory req = VRFV2PlusClient.RandomWordsRequest({
            keyHash: bytes32(uint256(0xabc)),
            subId: 42,
            requestConfirmations: 3,
            callbackGasLimit: 2_500_000,
            numWords: 2,
            extraArgs: VRFV2PlusClient._argsToBytes(VRFV2PlusClient.ExtraArgsV1({nativePayment: true}))
        });

        bytes memory actual = abi.encodeWithSelector(IVRFCoordinatorV2Plus.requestRandomWords.selector, req);

        bytes memory expected = abi.encodePacked(
            CHAINLINK_REQUEST_SELECTOR,
            uint256(0x20), // offset to the tuple
            uint256(0xabc), // keyHash
            uint256(42), // subId
            uint256(3), // requestConfirmations
            uint256(2_500_000), // callbackGasLimit
            uint256(2), // numWords
            uint256(0xc0), // offset to extraArgs, relative to the tuple
            uint256(0x24), // extraArgs length: 4-byte tag + one word
            CHAINLINK_EXTRA_ARGS_V1_TAG,
            uint256(1), // nativePayment = true
            // abi.encodePacked leaves the trailing bytes of the dynamic field unpadded; the encoder
            // pads to a 32-byte boundary, so account for the 28 bytes that follow the bool word.
            bytes28(0)
        );

        assertEq(actual, expected, "request calldata layout drifted from Chainlink's tuple order");
    }

    function test_extraArgsEncodesBothPaymentModes() public pure {
        bytes memory native = VRFV2PlusClient._argsToBytes(VRFV2PlusClient.ExtraArgsV1({nativePayment: true}));
        bytes memory link = VRFV2PlusClient._argsToBytes(VRFV2PlusClient.ExtraArgsV1({nativePayment: false}));

        assertEq(native, abi.encodePacked(CHAINLINK_EXTRA_ARGS_V1_TAG, uint256(1)), "native payment args drifted");
        assertEq(link, abi.encodePacked(CHAINLINK_EXTRA_ARGS_V1_TAG, uint256(0)), "LINK payment args drifted");
        assertEq(native.length, 36, "extraArgs must be a 4-byte tag plus one word");
    }
}

// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @title DeterministicFactory
/// @notice Deploys UUPS proxies at the same address on every chain, and initializes them in the SAME
///         transaction (spec §3 addressing, §11 step 2 "initialize atomically, guard init front-run").
///
/// @dev Why a factory rather than `new ERC1967Proxy{salt}(impl, initData)` directly:
///
///      A proxy's CREATE2 address depends on its constructor arguments. The GachaMachine's initializer
///      legitimately pins chain-specific values (VRF coordinator, subscription id), so folding the init
///      data into the constructor would give a different address on every chain — defeating the point.
///      Deploying with EMPTY constructor init data keeps the address identical everywhere, but leaves a
///      window in which anyone could front-run `initialize`. Doing both steps inside one factory call
///      closes that window: the proxy is created and initialized atomically, and its address depends
///      only on `(factory, salt, implementation)`.
///
///      The factory itself is deployed through the standard CREATE2 deployer
///      (0x4e59b44847b379578588920cA78FbF26c0B4956C) with a fixed salt, so it too has the same address
///      on every chain.
///
///      SECURITY NOTE, stated plainly: identical cross-chain addresses are a deployment convenience,
///      not a safety property — they are precisely what makes cross-chain signature replay possible.
///      What actually prevents replay is the EIP-712 domain binding `chainId` + `verifyingContract`,
///      covered by `test/unit/CrossChainReplay.t.sol`.
contract DeterministicFactory {
    error InitializationFailed(bytes reason);
    error AlreadyDeployed(address existing);

    event ProxyDeployed(address indexed proxy, address indexed implementation, bytes32 salt);

    /// @notice Deploys an ERC-1967 proxy at a deterministic address and initializes it atomically.
    /// @param salt Deployment salt. Use the same salt on every chain for the same logical contract.
    /// @param implementation Implementation address (itself CREATE2-deployed for cross-chain parity).
    /// @param initData ABI-encoded `initialize(...)` call. May differ per chain without moving the address.
    function deployProxy(bytes32 salt, address implementation, bytes calldata initData)
        external
        returns (address proxy)
    {
        address predicted = predictProxyAddress(salt, implementation);
        if (predicted.code.length != 0) revert AlreadyDeployed(predicted);

        proxy = address(new ERC1967Proxy{salt: salt}(implementation, ""));

        if (initData.length != 0) {
            (bool ok, bytes memory reason) = proxy.call(initData);
            if (!ok) revert InitializationFailed(reason);
        }
        emit ProxyDeployed(proxy, implementation, salt);
    }

    /// @notice The address {deployProxy} will produce, for pre-flight checks and `deployments.json`.
    function predictProxyAddress(bytes32 salt, address implementation) public view returns (address) {
        bytes32 initCodeHash =
            keccak256(abi.encodePacked(type(ERC1967Proxy).creationCode, abi.encode(implementation, bytes(""))));
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash)))));
    }
}

// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {FaucetStablecoin} from "../src/testing/FaucetStablecoin.sol";

/**
 * Deploys the faucet stablecoin for a testnet.
 *
 *   TOKEN_NAME="Collector USD" TOKEN_SYMBOL=cUSD \
 *   forge script script/DeployFaucet.s.sol:DeployFaucet --rpc-url "$RPC_URL" --broadcast
 *
 * Replaces `DeployTestToken.s.sol`, which minted only through an ops call. That was enough to fund a
 * reserve but left a tester with no way to obtain the pay token themselves — the thing that actually
 * blocked using the product on chains whose public faucet drips ten dollars a day.
 *
 * Deployed to all testnets rather than only the ones without a canonical stablecoin: using the same
 * token everywhere means one claim flow, one decimals assumption, and one address to configure per
 * chain, instead of Circle USDC here and something else there.
 */
contract DeployFaucet is Script {
    function run() external {
        // The contract's constructor enforces this too. Checking here as well means the script fails
        // before spending gas, and says why.
        uint256 id = block.chainid;
        require(
            id != 1 && id != 56 && id != 137 && id != 8453 && id != 42161 && id != 4663,
            "refusing to deploy a faucet token to a production chain"
        );

        string memory name = vm.envOr("TOKEN_NAME", string("Collector USD"));
        string memory symbol = vm.envOr("TOKEN_SYMBOL", string("cUSD"));

        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        FaucetStablecoin token = new FaucetStablecoin(name, symbol);
        vm.stopBroadcast();

        console2.log("");
        console2.log("FaucetStablecoin:", address(token));
        console2.log("  chain id      ", block.chainid);
        console2.log("  decimals       6");
        console2.log("  claim()        500 per address per 24h");
        console2.log("  mint()         unrestricted, for reserve funding");
        console2.log("");
        console2.log("Next:");
        console2.log("  1. put this address in the chain's payTokens in script/chains.json");
        console2.log("  2. allowlist it on the PaymentRouter [Timelock]");
        console2.log("  3. commit a pool version whose payToken is this address");
    }
}

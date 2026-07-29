// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title TestStablecoin
/// @notice Six-decimal faucet token for testnet rehearsals. NEVER deploy this to a production chain.
/// @dev Anyone may mint, without limit. That is the point on a testnet — a tester who cannot get the
///      pay token cannot test anything — and it is precisely why this contract must never sit behind
///      a real deployment. `PaymentRouter`'s allowlist is what enforces that: a token is only
///      spendable once governance has explicitly allowed it, so this cannot leak into production by
///      being deployed to the wrong chain alone.
contract TestStablecoin is ERC20 {
    /// @notice Mirrors USDC/USDT so amounts, price refs and UI formatting behave as they will live.
    uint8 private constant DECIMALS = 6;

    /// @notice Cap per call, purely so a fat-fingered faucet request does not produce an absurd
    ///         balance that then makes every screenshot and log unreadable.
    uint256 public constant MAX_MINT = 1_000_000e6;

    error MintTooLarge(uint256 requested, uint256 max);

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function decimals() public pure override returns (uint8) {
        return DECIMALS;
    }

    function mint(address to, uint256 amount) external {
        if (amount > MAX_MINT) revert MintTooLarge(amount, MAX_MINT);
        _mint(to, amount);
    }
}

/**
 * Deploys a faucet stablecoin for a testnet chain.
 *
 *   CHAIN_KEY=bnb_testnet TOKEN_NAME="Test USD" TOKEN_SYMBOL=tUSD \
 *   forge script script/DeployTestToken.s.sol:DeployTestToken --rpc-url "$RPC_URL" --broadcast
 *
 * Some testnets have a canonical stablecoin and some do not. Base Sepolia has real Circle USDC and
 * should use it. BNB testnet has none — only community tokens with unknown minting control — so a
 * token we deploy ourselves is the more honest basis for a rehearsal: we know exactly who can mint it.
 *
 * Paste the printed address into the chain's `payTokens` in chains.json, then allowlist it on the
 * PaymentRouter through governance like any other pay token.
 */
contract DeployTestToken is Script {
    /// @dev Chain ids that must never see this contract. A testnet faucet token allowlisted on a
    ///      production PaymentRouter would let anyone mint themselves packs for free.
    function _assertNotProduction() internal view {
        uint256 id = block.chainid;
        require(
            id != 1 && id != 56 && id != 137 && id != 8453 && id != 42161 && id != 4663,
            "refusing to deploy a faucet token to a production chain"
        );
    }

    function run() external {
        _assertNotProduction();

        string memory name = vm.envOr("TOKEN_NAME", string("Test USD"));
        string memory symbol = vm.envOr("TOKEN_SYMBOL", string("tUSD"));

        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        TestStablecoin token = new TestStablecoin(name, symbol);
        vm.stopBroadcast();

        console2.log("");
        console2.log("TestStablecoin deployed:", address(token));
        console2.log("  chain id:", block.chainid);
        console2.log("  decimals: 6, unrestricted mint, max", TestStablecoin(token).MAX_MINT() / 1e6, "per call");
        console2.log("");
        console2.log("Next:");
        console2.log("  1. add this address to the chain's payTokens in script/chains.json");
        console2.log("  2. allowlist it: PaymentRouter.setAllowedPayToken(token, true)  [Timelock]");
        console2.log("  3. mint yourself a balance: cast send <token> 'mint(address,uint256)' <you> 100000000000");
    }
}

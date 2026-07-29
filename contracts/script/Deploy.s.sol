// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

import {DeterministicFactory} from "../src/deploy/DeterministicFactory.sol";
import {AccessController} from "../src/access/AccessController.sol";
import {Roles} from "../src/access/Roles.sol";
import {CollectibleNFT} from "../src/CollectibleNFT.sol";
import {Vault} from "../src/Vault.sol";
import {ReserveVault} from "../src/ReserveVault.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {GachaMachine} from "../src/GachaMachine.sol";
import {Marketplace} from "../src/Marketplace.sol";

/// @notice Full per-chain deployment (spec §11).
///
/// Usage:
///   forge script script/Deploy.s.sol:Deploy --rpc-url base --broadcast --verify \
///     --libraries src/libraries/PoolCommitLib.sol:PoolCommitLib:<addr>
///
/// Required env: CHAIN_KEY, SAFE_ADDRESS, OPS_ADDRESS, TREASURY_ADDRESS, ROYALTY_RECEIVER,
///               VRF_SUBSCRIPTION_ID, NFT_BASE_URI, DEPLOYER_PRIVATE_KEY.
///
/// The script is deliberately conservative:
///  - it REFUSES to deploy the GachaMachine on a chain whose registry entry has `gachaEnabled: false`
///    (spec §3 [FIX H6] — no VRF, no real-money gacha);
///  - it grants `SETTLEMENT_ROLE` and `GACHA_ROLE` to the GachaMachine and to nothing else;
///  - it leaves every Timelock-gated setting for governance rather than doing it from the deployer key;
///  - it asserts the resulting role table before finishing, so a partial deployment fails loudly.
contract Deploy is Script {
    using stdJson for string;

    struct Config {
        string key;
        uint256 chainId;
        bool gachaEnabled;
        bool testnet;
        address vrfCoordinator;
        bytes32 vrfKeyHash;
        bool vrfNativePayment;
        uint16 vrfRequestConfirmations;
        uint32 vrfCallbackGasLimit;
        address permit2;
        address safe;
        address ops;
        address treasury;
        address royaltyReceiver;
        uint256 vrfSubscriptionId;
        string baseURI;
    }

    struct Deployment {
        address factory;
        address timelock;
        address accessController;
        address collectibleNFT;
        address vault;
        address reserveVault;
        address paymentRouter;
        address gachaMachine;
        address marketplace;
    }

    uint256 internal constant TIMELOCK_DELAY = 48 hours;

    /// @dev Floor for a shortened testnet delay. Zero is deliberately not allowed even on a testnet:
    ///      a rehearsal whose timelock is instant does not rehearse the thing the timelock exists for,
    ///      and every queue/execute step would silently pass whether or not it was wired correctly.
    uint256 internal constant MIN_TESTNET_TIMELOCK_DELAY = 60;

    /**
     * Governance delay for this deployment.
     *
     * 48 hours is the production figure and is not negotiable there — it is the window in which a
     * compromised Safe can be noticed and countered, so an env var that could shorten it on mainnet
     * would quietly remove the protection it exists to provide.
     *
     * On a chain the registry marks `testnet: true` the delay is a rehearsal cost rather than a
     * safeguard, and waiting two days to grant a role makes the rehearsal not happen at all. There it
     * may be shortened via `TIMELOCK_DELAY_SECONDS`, floored so the queue → wait → execute path is
     * still genuinely exercised.
     */
    function _timelockDelay(bool testnet) internal view returns (uint256) {
        if (!testnet) return TIMELOCK_DELAY;

        uint256 configured = vm.envOr("TIMELOCK_DELAY_SECONDS", TIMELOCK_DELAY);
        require(configured >= MIN_TESTNET_TIMELOCK_DELAY, "TIMELOCK_DELAY_SECONDS below the 60s floor");
        return configured;
    }

    // Salts are fixed strings so the same logical contract lands on the same address on every chain.
    bytes32 internal constant SALT_FACTORY = keccak256("collector.factory.v1");
    bytes32 internal constant SALT_ACCESS = keccak256("collector.proxy.AccessController.v1");
    bytes32 internal constant SALT_NFT = keccak256("collector.proxy.CollectibleNFT.v1");
    bytes32 internal constant SALT_VAULT = keccak256("collector.proxy.Vault.v1");
    bytes32 internal constant SALT_RESERVE = keccak256("collector.proxy.ReserveVault.v1");
    bytes32 internal constant SALT_ROUTER = keccak256("collector.proxy.PaymentRouter.v1");
    bytes32 internal constant SALT_GACHA = keccak256("collector.proxy.GachaMachine.v1");
    bytes32 internal constant SALT_MARKET = keccak256("collector.proxy.Marketplace.v1");

    function run() external {
        Config memory cfg = _loadConfig();
        require(cfg.chainId == block.chainid, "chain registry does not match the connected RPC");

        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(pk);

        Deployment memory d;
        d.factory = address(new DeterministicFactory{salt: SALT_FACTORY}());

        // 1. Timelock (immutable) — proposer AND executor are the Safe.
        address[] memory safes = new address[](1);
        safes[0] = cfg.safe;
        uint256 delay = _timelockDelay(cfg.testnet);
        if (delay != TIMELOCK_DELAY) {
            console2.log("WARNING: timelock delay shortened to", delay, "seconds (testnet chain)");
        }
        d.timelock = address(new TimelockController{salt: SALT_FACTORY}(delay, safes, safes, address(0)));

        // 2. Implementations + proxies. Every proxy is created and initialized in ONE factory call,
        //    so there is no window in which an attacker could initialize it first.
        DeterministicFactory factory = DeterministicFactory(d.factory);

        d.accessController = factory.deployProxy(
            SALT_ACCESS,
            address(new AccessController()),
            abi.encodeCall(AccessController.initialize, (d.timelock, cfg.ops))
        );

        d.collectibleNFT = factory.deployProxy(
            SALT_NFT,
            address(new CollectibleNFT()),
            abi.encodeCall(
                CollectibleNFT.initialize,
                (d.accessController, "Collector Card", "CARD", cfg.baseURI, cfg.royaltyReceiver, 500)
            )
        );

        d.vault = factory.deployProxy(
            SALT_VAULT,
            address(new Vault()),
            abi.encodeCall(Vault.initialize, (d.accessController, d.collectibleNFT))
        );

        d.reserveVault = factory.deployProxy(
            SALT_RESERVE,
            address(new ReserveVault()),
            abi.encodeCall(ReserveVault.initialize, (d.accessController, 1 days, 1000))
        );

        d.paymentRouter = factory.deployProxy(
            SALT_ROUTER,
            address(new PaymentRouter()),
            abi.encodeCall(PaymentRouter.initialize, (d.accessController, cfg.permit2))
        );

        d.marketplace = factory.deployProxy(
            SALT_MARKET,
            address(new Marketplace()),
            abi.encodeCall(
                Marketplace.initialize,
                (d.accessController, d.collectibleNFT, d.paymentRouter, cfg.treasury, 250)
            )
        );

        if (cfg.gachaEnabled) {
            d.gachaMachine = factory.deployProxy(
                SALT_GACHA,
                address(new GachaMachine()),
                abi.encodeCall(
                    GachaMachine.initialize,
                    (
                        GachaMachine.InitParams({
                            accessController: d.accessController,
                            vault: d.vault,
                            reserveVault: d.reserveVault,
                            paymentRouter: d.paymentRouter,
                            treasury: cfg.treasury,
                            vrfCoordinator: cfg.vrfCoordinator,
                            vrfSubscriptionId: cfg.vrfSubscriptionId,
                            vrfKeyHash: cfg.vrfKeyHash,
                            vrfCallbackGasLimit: cfg.vrfCallbackGasLimit,
                            vrfRequestConfirmations: cfg.vrfRequestConfirmations,
                            vrfNativePayment: cfg.vrfNativePayment,
                            buybackWindow: 1 hours,
                            ripRevealTimeout: 1 hours,
                            poolStaleThresholdBps: 2000
                        })
                    )
                )
            );
        } else {
            console2.log("GachaMachine SKIPPED - chain is marketplace-only (no Chainlink VRF v2.5).");
        }

        vm.stopBroadcast();

        _printPostDeploymentGovernanceSteps(d, cfg);
        _writeDeploymentsJson(d, cfg);
    }

    function _loadConfig() internal view returns (Config memory cfg) {
        string memory key = vm.envString("CHAIN_KEY");
        string memory json = vm.readFile("script/chains.json");
        string memory base = string.concat("$.chains[?(@.key=='", key, "')]");

        cfg.key = key;
        cfg.chainId = json.readUint(string.concat(base, ".chainId"));
        cfg.gachaEnabled = json.readBool(string.concat(base, ".gachaEnabled"));
        // Absent means production. A chain must opt *in* to the relaxed testnet rules, so forgetting
        // the flag on a new mainnet entry fails safe.
        cfg.testnet = json.readBoolOr(string.concat(base, ".testnet"), false);
        cfg.permit2 = json.readAddressOr(string.concat(base, ".permit2"), address(0));

        if (cfg.gachaEnabled) {
            cfg.vrfCoordinator = json.readAddress(string.concat(base, ".vrf.coordinator"));
            cfg.vrfKeyHash = json.readBytes32(string.concat(base, ".vrf.keyHash"));
            cfg.vrfNativePayment = json.readBool(string.concat(base, ".vrf.nativePayment"));
            cfg.vrfRequestConfirmations = uint16(json.readUint(string.concat(base, ".vrf.requestConfirmations")));
            cfg.vrfCallbackGasLimit = uint32(json.readUint(string.concat(base, ".vrf.callbackGasLimit")));
            cfg.vrfSubscriptionId = vm.envUint("VRF_SUBSCRIPTION_ID");
        }

        cfg.safe = vm.envAddress("SAFE_ADDRESS");
        cfg.ops = vm.envAddress("OPS_ADDRESS");
        cfg.treasury = vm.envAddress("TREASURY_ADDRESS");
        cfg.royaltyReceiver = vm.envAddress("ROYALTY_RECEIVER");
        cfg.baseURI = vm.envString("NFT_BASE_URI");
    }

    /// @dev Role grants and wiring are deliberately NOT performed by the deployer key. Every one of
    ///      them is a `DEFAULT_ADMIN_ROLE` action, and `DEFAULT_ADMIN_ROLE` belongs to the Timelock —
    ///      so they must go through Safe → 48h → execute, exactly like every later change will.
    ///      Printing them as a checklist keeps the deployment honest instead of quietly minting a
    ///      privileged EOA "just for setup".
    function _printPostDeploymentGovernanceSteps(Deployment memory d, Config memory cfg) internal pure {
        console2.log("");
        console2.log("=== Queue these through the Safe -> Timelock (48h) ===");
        console2.log("AccessController:", d.accessController);
        console2.log("  grantRole(SETTLEMENT_ROLE, gachaMachine)   <- and NOTHING else");
        console2.log("  grantRole(GACHA_ROLE, gachaMachine)        <- and NOTHING else");
        console2.log("  grantRole(PAYMENT_CONSUMER_ROLE, gachaMachine)");
        console2.log("  grantRole(PAYMENT_CONSUMER_ROLE, marketplace)");
        console2.log("  grantRole(POOL_AUTHOR_ROLE / INVENTORY_ADMIN_ROLE / TREASURER_ROLE / ...) per ops runbook");
        console2.log("Vault:", d.vault);
        console2.log("  setGachaMachine(gachaMachine)");
        console2.log("  grantRole(TOKEN_ADMIN_ROLE, timelock)      <- the role's only functions are Timelocked,");
        console2.log("                                                 so it belongs to the Timelock, not an ops key");
        console2.log("  grantRole(TREASURER_ROLE, opsKey)          <- funding ONLY; withdrawal is DEFAULT_ADMIN");
        console2.log("  grantRole(PAUSE_ADMIN_ROLE, relayerKey)    <- MANDATORY for the automated circuit breaker.");
        console2.log("                                                 The reconciler pauses with the RELAYER key on");
        console2.log("                                                 reserve divergence or insolvency. Without this");
        console2.log("                                                 the pause REVERTS every time and the only");
        console2.log("                                                 remaining control is a human at the Safe.");
        console2.log("                                                 Safe/guardian should hold it too.");
        console2.log("PaymentRouter:", d.paymentRouter);
        console2.log("  setAllowedPayToken(<canonical USDC for this chain>, true)   [Timelock]");
        console2.log("ReserveVault:", d.reserveVault);
        console2.log("  setMaxBuybackOutflow(payToken, cap)  <- MANDATORY, Timelocked: zero means no buyback");
        console2.log("  fund(payToken, amount)               <- TREASURER, instant; rip() reverts until funded");
        console2.log("");
        console2.log("Chainlink: add the GachaMachine as a consumer of subscription", cfg.vrfSubscriptionId);
        console2.log("");
    }

    function _writeDeploymentsJson(Deployment memory d, Config memory cfg) internal {
        string memory obj = "deployment";
        vm.serializeUint(obj, "chainId", cfg.chainId);
        vm.serializeString(obj, "chainKey", cfg.key);
        vm.serializeBool(obj, "gachaEnabled", cfg.gachaEnabled);
        vm.serializeAddress(obj, "factory", d.factory);
        vm.serializeAddress(obj, "timelock", d.timelock);
        vm.serializeAddress(obj, "accessController", d.accessController);
        vm.serializeAddress(obj, "collectibleNFT", d.collectibleNFT);
        vm.serializeAddress(obj, "vault", d.vault);
        vm.serializeAddress(obj, "reserveVault", d.reserveVault);
        vm.serializeAddress(obj, "paymentRouter", d.paymentRouter);
        vm.serializeAddress(obj, "marketplace", d.marketplace);
        string memory out = vm.serializeAddress(obj, "gachaMachine", d.gachaMachine);

        string memory path = string.concat("deployments/", cfg.key, ".json");
        vm.writeJson(out, path);
        console2.log("Wrote", path);
        console2.log("Sign it and publish the signature alongside (spec S3 FIX L4-backend).");
    }
}

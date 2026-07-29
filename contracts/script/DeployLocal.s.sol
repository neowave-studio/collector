// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

import {AccessController} from "../src/access/AccessController.sol";
import {Roles} from "../src/access/Roles.sol";
import {CollectibleNFT} from "../src/CollectibleNFT.sol";
import {Vault} from "../src/Vault.sol";
import {ReserveVault} from "../src/ReserveVault.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {GachaMachine} from "../src/GachaMachine.sol";
import {Marketplace} from "../src/Marketplace.sol";
import {PoolLib} from "../src/libraries/PoolLib.sol";

import {MockERC20} from "../test/mocks/MockERC20.sol";
import {MockVRFCoordinator} from "../test/mocks/MockVRFCoordinator.sol";

/// @notice **LOCAL DEVNET ONLY.** Deploys the whole system to anvil, wires every role, mints demo
///         inventory, commits a pool and activates it — so the backend and frontend have something
///         real to talk to in one command.
///
/// This deliberately differs from `Deploy.s.sol` in exactly two ways, both of which would be
/// unacceptable on a real chain and are why this is a separate file rather than a flag:
///
///   1. **The Timelock delay is zero**, so setup completes in one run instead of over 48 hours.
///   2. **A mock VRF coordinator** stands in for Chainlink, so a test can decide the outcome.
///      `npm run devnet:reveal <requestId> <word>` delivers the randomness by hand.
///
/// Everything else is the production wiring: real proxies, real role separation, `SETTLEMENT_ROLE`
/// and `GACHA_ROLE` granted only to the GachaMachine, reserve funded before any pack can be sold.
contract DeployLocal is Script {
    // Anvil's deterministic accounts, matching the keys in `backend/.env.example`.
    address internal constant DEPLOYER = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266; // #0
    address internal constant ORACLE = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8; // #1
    address internal constant RELAYER = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC; // #2
    address internal constant BUYBACK = 0x90F79bf6EB2c4f870365E785982E1f101E93b906; // #3
    address internal constant POOL_AUTHOR = 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65; // #4
    address internal constant USER = 0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc; // #5 — a demo buyer

    bytes32 internal constant PACK_ID = keccak256("PKMN50");
    uint256 internal constant VERSION = 1;
    uint256 internal constant PRICE_PER_RIP = 50e6;
    uint256 internal constant CARD_COUNT = 8;

    function run() external {
        uint256 pk = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        vm.startBroadcast(pk);

        MockERC20 usdc = new MockERC20("USD Coin", "USDC", 6);
        MockVRFCoordinator vrf = new MockVRFCoordinator();

        // Zero delay so `run` completes in one pass. Real deployments use 48 hours.
        address[] memory admins = new address[](1);
        admins[0] = DEPLOYER;
        TimelockController timelock = new TimelockController(0, admins, admins, address(0));

        AccessController access = AccessController(
            address(
                new ERC1967Proxy(
                    address(new AccessController()),
                    abi.encodeCall(AccessController.initialize, (address(timelock), DEPLOYER))
                )
            )
        );

        CollectibleNFT nft = CollectibleNFT(
            address(
                new ERC1967Proxy(
                    address(new CollectibleNFT()),
                    abi.encodeCall(
                        CollectibleNFT.initialize,
                        (address(access), "Collector Card", "CARD", "http://localhost:3000/api/meta/", DEPLOYER, 500)
                    )
                )
            )
        );

        Vault vault = Vault(
            address(
                new ERC1967Proxy(
                    address(new Vault()), abi.encodeCall(Vault.initialize, (address(access), address(nft)))
                )
            )
        );

        ReserveVault reserve = ReserveVault(
            address(
                new ERC1967Proxy(
                    address(new ReserveVault()),
                    abi.encodeCall(ReserveVault.initialize, (address(access), 1 days, 1000))
                )
            )
        );

        // Permit2 is not deployed on a fresh anvil, so this exercises the allowance fallback path —
        // the same one chains without Permit2 use in production.
        PaymentRouter router = PaymentRouter(
            address(
                new ERC1967Proxy(
                    address(new PaymentRouter()),
                    abi.encodeCall(PaymentRouter.initialize, (address(access), address(0)))
                )
            )
        );

        Marketplace market = Marketplace(
            address(
                new ERC1967Proxy(
                    address(new Marketplace()),
                    abi.encodeCall(
                        Marketplace.initialize, (address(access), address(nft), address(router), DEPLOYER, 250)
                    )
                )
            )
        );

        GachaMachine gacha = GachaMachine(
            address(
                new ERC1967Proxy(
                    address(new GachaMachine()),
                    abi.encodeCall(
                        GachaMachine.initialize,
                        (
                            GachaMachine.InitParams({
                                accessController: address(access),
                                vault: address(vault),
                                reserveVault: address(reserve),
                                paymentRouter: address(router),
                                treasury: DEPLOYER,
                                vrfCoordinator: address(vrf),
                                vrfSubscriptionId: 1,
                                vrfKeyHash: keccak256("devnet-gaslane"),
                                vrfCallbackGasLimit: 2_500_000,
                                vrfRequestConfirmations: 1,
                                vrfNativePayment: false,
                                buybackWindow: 5 minutes,
                                ripRevealTimeout: 10 minutes,
                                poolStaleThresholdBps: 5000
                            })
                        )
                    )
                )
            )
        );

        _wireRoles(access, timelock, vault, gacha, market);
        _seedInventory(nft, vault);
        _fundReserve(usdc, reserve, timelock);
        _commitAndActivate(gacha, timelock, usdc);

        // Give the demo buyer USDC. They still have to approve the router themselves from the UI.
        usdc.mint(USER, 100_000e6);
        usdc.mint(DEPLOYER, 100_000e6);

        vm.stopBroadcast();

        _writeDeployment(address(access), address(nft), address(vault), address(reserve), address(router), address(market), address(gacha), address(timelock), address(usdc), address(vrf));
    }

    function _wireRoles(
        AccessController access,
        TimelockController timelock,
        Vault vault,
        GachaMachine gacha,
        Marketplace market
    ) internal {
        // DEFAULT_ADMIN lives with the Timelock exactly as in production; with a zero delay we can
        // schedule and execute in the same transaction.
        bytes32[7] memory opsRoles = [
            Roles.POOL_AUTHOR_ROLE,
            Roles.INVENTORY_ADMIN_ROLE,
            Roles.TREASURER_ROLE, // funding only — withdrawal and caps are DEFAULT_ADMIN
            Roles.FEE_ADMIN_ROLE,
            Roles.PAUSE_ADMIN_ROLE,
            Roles.MINTER_ROLE,
            Roles.RISK_ADMIN_ROLE
        ];
        for (uint256 i; i < opsRoles.length; ++i) {
            _timelocked(timelock, address(access), abi.encodeCall(access.grantRole, (opsRoles[i], DEPLOYER)));
        }

        // Every TOKEN_ADMIN function is Timelock-gated, so the role belongs to the Timelock itself
        // rather than to an ops key that would then be able to skip the delay.
        _timelocked(
            timelock, address(access), abi.encodeCall(access.grantRole, (Roles.TOKEN_ADMIN_ROLE, address(timelock)))
        );
        _timelocked(timelock, address(access), abi.encodeCall(access.grantRole, (Roles.POOL_AUTHOR_ROLE, POOL_AUTHOR)));

        // The reconciler pauses with the RELAYER key when it sees reserve divergence or insolvency, so
        // that key needs PAUSE_ADMIN_ROLE or the automated circuit breaker cannot fire at all — it
        // reverts on every attempt and the only remaining control is a human at the Safe. Granting it
        // here means the devnet exercises the same breaker production relies on.
        //
        // Pausing is deliberately the one privilege extended to a hot key: the worst a stolen relayer
        // can do with it is halt buyback and new rips, which the Timelock can undo. Every user escape
        // hatch (claimAfterTimeout, self-settle) keeps working while paused.
        //
        // It goes through the Timelock because PAUSE_ADMIN_ROLE is administered by DEFAULT_ADMIN_ROLE,
        // which only the Timelock holds — the deployer cannot grant it directly.
        _timelocked(timelock, address(access), abi.encodeCall(access.grantRole, (Roles.PAUSE_ADMIN_ROLE, RELAYER)));

        // The two roles that must have exactly one holder each.
        _timelocked(timelock, address(access), abi.encodeCall(access.grantRole, (Roles.SETTLEMENT_ROLE, address(gacha))));
        _timelocked(timelock, address(access), abi.encodeCall(access.grantRole, (Roles.GACHA_ROLE, address(gacha))));
        _timelocked(
            timelock, address(access), abi.encodeCall(access.grantRole, (Roles.PAYMENT_CONSUMER_ROLE, address(gacha)))
        );
        _timelocked(
            timelock, address(access), abi.encodeCall(access.grantRole, (Roles.PAYMENT_CONSUMER_ROLE, address(market)))
        );
        _timelocked(timelock, address(vault), abi.encodeCall(vault.setGachaMachine, (address(gacha))));

        // Hot keys are delegated to OPERATIONS, so no timelock is involved — same as production.
        access.grantRole(Roles.TRUSTED_RELAYER_ROLE, RELAYER);
        access.grantRole(Roles.TRUSTED_ORACLE_ROLE, ORACLE);
        access.grantRole(Roles.TRUSTED_BUYBACK_ROLE, BUYBACK);
    }

    function _timelocked(TimelockController timelock, address target, bytes memory data) internal {
        timelock.schedule(target, 0, data, bytes32(0), bytes32(0), 0);
        timelock.execute(target, 0, data, bytes32(0), bytes32(0));
    }

    function _seedInventory(CollectibleNFT nft, Vault vault) internal {
        uint256[] memory ids = new uint256[](CARD_COUNT);
        bytes32[] memory commitments = new bytes32[](CARD_COUNT);
        for (uint256 i; i < CARD_COUNT; ++i) {
            ids[i] = i + 1;
            commitments[i] = keccak256(abi.encode("PSA-DEVNET", i + 1));
        }
        nft.mintBatch(DEPLOYER, ids, commitments);
        nft.setApprovalForAll(address(vault), true);
        vault.depositBatch(ids, PACK_ID);
    }

    function _fundReserve(MockERC20 usdc, ReserveVault reserve, TimelockController timelock) internal {
        _timelocked(
            timelock,
            address(reserve),
            abi.encodeCall(reserve.setMaxBuybackOutflow, (address(usdc), 1_000_000e6))
        );

        // `rip` books a pack's worst case up front, so the reserve must be funded before a single
        // pack can be sold. This is the same ordering constraint production has.
        usdc.mint(DEPLOYER, 2_000_000e6);
        usdc.approve(address(reserve), type(uint256).max);
        reserve.fund(address(usdc), 2_000_000e6);
    }

    function _commitAndActivate(GachaMachine gacha, TimelockController timelock, MockERC20 usdc) internal {
        _timelocked(
            timelock,
            address(gacha.paymentRouter()),
            abi.encodeCall(PaymentRouter.setAllowedPayToken, (address(usdc), true))
        );

        PoolLib.Leaf[] memory leaves = _leaves();
        gacha.commitPool(
            PACK_ID,
            VERSION,
            PoolLib.PoolParams({
                pricePerRip: PRICE_PER_RIP,
                payToken: address(usdc),
                buybackBps: 8500,
                unavailableBps: 10_000,
                houseMarginBps: 1000,
                reserveBps: 4000,
                poolCID: keccak256("devnet-pool-v1")
            }),
            leaves
        );

        // Announced, never same-block. The offset is deliberately large: `forge script` computes this
        // during LOCAL execution, then broadcasts ~60 transactions, each of which mines a block. A tight
        // offset would already be in the past by the time this transaction lands, and the contract would
        // (correctly) reject it. The devnet runner mines past `activeFromBlock` afterwards.
        gacha.setActivePoolVersion(PACK_ID, VERSION, uint64(block.number + 500));
    }

    /// @dev Eight cards: six commons, one rare, one grail. Weighted mean reference value is well
    ///      inside the house-margin invariant, so `commitPool` accepts it.
    function _leaves() internal pure returns (PoolLib.Leaf[] memory leaves) {
        uint256[8] memory weights = [uint256(300), 250, 200, 120, 80, 30, 15, 5];
        uint256[8] memory priceRefs =
            [uint256(20e6), 24e6, 28e6, 35e6, 48e6, 90e6, 180e6, 600e6];

        leaves = new PoolLib.Leaf[](CARD_COUNT);
        uint256 cum;
        for (uint256 i; i < CARD_COUNT; ++i) {
            leaves[i] = PoolLib.Leaf({tokenId: i + 1, cumBefore: cum, weight: weights[i], priceRef: priceRefs[i]});
            cum += weights[i];
        }
    }

    function _writeDeployment(
        address access,
        address nft,
        address vault,
        address reserve,
        address router,
        address market,
        address gacha,
        address timelock,
        address usdc,
        address vrf
    ) internal {
        string memory obj = "devnet";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeString(obj, "chainKey", "anvil");
        vm.serializeBool(obj, "gachaEnabled", true);
        vm.serializeAddress(obj, "factory", address(0));
        vm.serializeAddress(obj, "timelock", timelock);
        vm.serializeAddress(obj, "accessController", access);
        vm.serializeAddress(obj, "collectibleNFT", nft);
        vm.serializeAddress(obj, "vault", vault);
        vm.serializeAddress(obj, "reserveVault", reserve);
        vm.serializeAddress(obj, "paymentRouter", router);
        vm.serializeAddress(obj, "marketplace", market);
        vm.serializeAddress(obj, "usdc", usdc);
        vm.serializeAddress(obj, "vrfCoordinator", vrf);
        string memory out = vm.serializeAddress(obj, "gachaMachine", gacha);
        vm.writeJson(out, "deployments/anvil.json");

        console2.log("");
        console2.log("Devnet ready. deployments/anvil.json written.");
        console2.log("  USDC           ", usdc);
        console2.log("  GachaMachine   ", gacha);
        console2.log("  VRF (mock)     ", vrf);
        console2.log("");
        console2.log("Demo buyer 0x9965...A4dc holds 100,000 USDC.");
        console2.log("Reveal a draw with: npm run devnet:reveal -- <requestId> <randomWord>");
    }
}

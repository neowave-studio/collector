// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {AccessController} from "../src/access/AccessController.sol";
import {Roles} from "../src/access/Roles.sol";
import {CollectibleNFT} from "../src/CollectibleNFT.sol";
import {Vault} from "../src/Vault.sol";
import {ReserveVault} from "../src/ReserveVault.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {GachaMachine} from "../src/GachaMachine.sol";
import {PoolLib} from "../src/libraries/PoolLib.sol";

/**
 * Post-deployment wiring for a testnet rehearsal.
 *
 *   MODE=schedule forge script script/SetupTestnet.s.sol:SetupTestnet --rpc-url $RPC_URL --broadcast
 *   # wait out the timelock delay
 *   MODE=execute  forge script script/SetupTestnet.s.sol:SetupTestnet --rpc-url $RPC_URL --broadcast
 *
 * `Deploy.s.sol` deliberately stops after creating contracts and prints the governance steps rather
 * than performing them, because on mainnet each one goes through a Safe and a 48h delay. That is
 * correct, and it also means a testnet is left inert. This script performs the same steps against an
 * existing deployment so the rehearsal can actually run.
 *
 * The two phases exist because the Timelock is real here — schedule and execute cannot share a
 * transaction when the delay is non-zero. That is the point: this exercises the same queue → wait →
 * execute path production uses, rather than pretending governance is instant.
 *
 * Everything is batched into ONE timelock operation. Sixteen separate schedules would each need
 * their own wait and their own execute, and a half-applied role table is far harder to reason about
 * than an atomic one.
 */
contract SetupTestnet is Script {
    using stdJson for string;

    bytes32 internal constant PACK_ID = keccak256("collector.pack.elite.v1");
    uint256 internal constant VERSION = 1;
    uint32 internal constant CARD_COUNT = 8;

    /// @dev Salt pins the batch identity so `execute` reconstructs the same operation id `schedule`
    ///      created. Any drift between the two phases surfaces as "operation is not ready" rather
    ///      than as a silently different batch.
    bytes32 internal constant BATCH_SALT = keccak256("collector.testnet.setup.v1");

    /**
     * Sized for a Circle faucet balance, not for a realistic product.
     *
     * A pack is 1 USDC and the grail reference is 3 USDC, so `rip` books 3 USDC of reserve per open
     * (maxPriceRef · unavailableBps). At the devnet's 50 USDC price the reserve alone would need more
     * than the faucet dispenses in a week, and the rehearsal would stall before reaching the VRF call
     * that is the entire point of it.
     *
     * The house-margin invariant still has to hold on these numbers, and does: expected payout is
     * 8500 · 507e6 vs an allowed 1e6 · 9000 · 1000, so roughly half the headroom is unused.
     */
    uint256 internal constant PRICE_PER_RIP = 1e6;

    struct Addrs {
        address accessController;
        address collectibleNFT;
        address vault;
        address reserveVault;
        address paymentRouter;
        address marketplace;
        address gachaMachine;
        address timelock;
    }

    function _load() internal view returns (Addrs memory a, address payToken) {
        string memory key = vm.envString("CHAIN_KEY");
        string memory dep = vm.readFile(string.concat("deployments/", key, ".json"));

        a.accessController = dep.readAddress(".accessController");
        a.collectibleNFT = dep.readAddress(".collectibleNFT");
        a.vault = dep.readAddress(".vault");
        a.reserveVault = dep.readAddress(".reserveVault");
        a.paymentRouter = dep.readAddress(".paymentRouter");
        a.marketplace = dep.readAddress(".marketplace");
        a.gachaMachine = dep.readAddress(".gachaMachine");
        a.timelock = dep.readAddress(".timelock");

        payToken = vm.envAddress("PAY_TOKEN");
    }

    /// @dev The single batch both phases operate on. Built identically in each so the operation id
    ///      matches; if it did not, `execute` would revert rather than apply a divergent batch.
    function _batch(Addrs memory a, address payToken)
        internal
        view
        returns (address[] memory targets, uint256[] memory values, bytes[] memory payloads)
    {
        address ops = vm.envAddress("OPS_ADDRESS");
        address relayer = vm.envAddress("RELAYER_ADDRESS");

        bytes32[7] memory opsRoles = [
            Roles.POOL_AUTHOR_ROLE,
            Roles.INVENTORY_ADMIN_ROLE,
            Roles.TREASURER_ROLE,
            Roles.FEE_ADMIN_ROLE,
            Roles.PAUSE_ADMIN_ROLE,
            Roles.MINTER_ROLE,
            Roles.RISK_ADMIN_ROLE
        ];

        uint256 n = opsRoles.length + 9;
        targets = new address[](n);
        values = new uint256[](n);
        payloads = new bytes[](n);

        uint256 i;
        for (uint256 r; r < opsRoles.length; ++r) {
            targets[i] = a.accessController;
            payloads[i] = abi.encodeCall(IAccessControl.grantRole, (opsRoles[r], ops));
            ++i;
        }

        // The two roles with exactly one legitimate holder each.
        targets[i] = a.accessController;
        payloads[i++] = abi.encodeCall(IAccessControl.grantRole, (Roles.SETTLEMENT_ROLE, a.gachaMachine));
        targets[i] = a.accessController;
        payloads[i++] = abi.encodeCall(IAccessControl.grantRole, (Roles.GACHA_ROLE, a.gachaMachine));

        targets[i] = a.accessController;
        payloads[i++] = abi.encodeCall(IAccessControl.grantRole, (Roles.PAYMENT_CONSUMER_ROLE, a.gachaMachine));
        targets[i] = a.accessController;
        payloads[i++] = abi.encodeCall(IAccessControl.grantRole, (Roles.PAYMENT_CONSUMER_ROLE, a.marketplace));

        // Every TOKEN_ADMIN function is itself Timelocked, so the role belongs to the Timelock rather
        // than to an ops key that could otherwise skip the delay.
        targets[i] = a.accessController;
        payloads[i++] = abi.encodeCall(IAccessControl.grantRole, (Roles.TOKEN_ADMIN_ROLE, a.timelock));

        // Without this the reconciler's automatic pause reverts on every attempt and the only control
        // left is a human at the Safe. See the note in DeployLocal.
        targets[i] = a.accessController;
        payloads[i++] = abi.encodeCall(IAccessControl.grantRole, (Roles.PAUSE_ADMIN_ROLE, relayer));

        targets[i] = a.vault;
        payloads[i++] = abi.encodeCall(Vault.setGachaMachine, (a.gachaMachine));

        targets[i] = a.paymentRouter;
        payloads[i++] = abi.encodeCall(PaymentRouter.setAllowedPayToken, (payToken, true));

        // Zero is not "no limit", it is "no buyback": every payout checks against this cap, so
        // leaving it unset blocks sell-back entirely while everything else looks correctly wired.
        // The reconciler says so once per pass, which is how this was caught.
        targets[i] = a.reserveVault;
        payloads[i++] = abi.encodeCall(ReserveVault.setMaxBuybackOutflow, (payToken, vm.envUint("MAX_BUYBACK_OUTFLOW")));

        require(i == n, "batch length mismatch");
    }

    function run() external {
        (Addrs memory a, address payToken) = _load();
        string memory mode = vm.envString("MODE");
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");

        (address[] memory targets, uint256[] memory values, bytes[] memory payloads) = _batch(a, payToken);
        TimelockController timelock = TimelockController(payable(a.timelock));

        if (keccak256(bytes(mode)) == keccak256("schedule")) {
            uint256 delay = timelock.getMinDelay();
            vm.startBroadcast(pk);
            timelock.scheduleBatch(targets, values, payloads, bytes32(0), BATCH_SALT, delay);
            vm.stopBroadcast();

            console2.log("");
            console2.log("Scheduled %s operations. Delay is %s seconds.", targets.length, delay);
            console2.log("Re-run with MODE=execute once it has passed.");
            return;
        }

        /**
         * Activation is its own phase, and that is not tidiness.
         *
         * `forge script` evaluates the script body locally to collect transactions, then broadcasts
         * them one at a time — each mining a block. `block.number` seen during that local pass is
         * therefore stale by however many blocks the broadcast takes: about 48 here, against a
         * required lead of 10. Any offset computed inside the same run that also does the setup is
         * racing the broadcast, and loses.
         *
         * Run alone, this is a single transaction, so the offset only has to cover the gap between
         * simulating and landing it.
         */
        if (keccak256(bytes(mode)) == keccak256("activate")) {
            GachaMachine gacha = GachaMachine(a.gachaMachine);
            uint256 minLead = gacha.minActivationDelayBlocks();

            /**
             * The margin has to be expressed per chain, because it is really a *time* budget wearing
             * block clothing: it must cover the wall-clock gap between this script simulating locally
             * and its transaction landing. Base mines every 2s and 20 blocks was plenty; BSC testnet
             * mines sub-second and burned 29 blocks during a single-transaction broadcast, which ate
             * the whole lead and the activation reverted as ActivationTooSoon.
             *
             * A number large enough for the fastest chain would push slow chains half an hour into
             * the future, so there is no safe constant. Set it per chain instead.
             */
            uint256 margin = vm.envOr("ACTIVATION_LEAD_BLOCKS", uint256(40));
            uint64 activeFrom = uint64(block.number + minLead + margin);

            vm.startBroadcast(pk);
            gacha.setActivePoolVersion(PACK_ID, VERSION, activeFrom);
            vm.stopBroadcast();

            console2.log("");
            console2.log("Pool v%s activates at block %s (now %s).", VERSION, activeFrom, block.number);
            return;
        }

        require(keccak256(bytes(mode)) == keccak256("execute"), "MODE must be schedule, execute or activate");

        vm.startBroadcast(pk);
        timelock.executeBatch(targets, values, payloads, bytes32(0), BATCH_SALT);

        // --- everything below is ops authority, not governance, so it needs no delay ------------
        AccessController access = AccessController(a.accessController);
        access.grantRole(Roles.TRUSTED_RELAYER_ROLE, vm.envAddress("RELAYER_ADDRESS"));
        access.grantRole(Roles.TRUSTED_ORACLE_ROLE, vm.envAddress("ORACLE_ADDRESS"));
        access.grantRole(Roles.TRUSTED_BUYBACK_ROLE, vm.envAddress("BUYBACK_ADDRESS"));

        _seedInventory(a, vm.addr(pk));
        _fundReserve(a, payToken);
        _commitPool(a, payToken);
        vm.stopBroadcast();

        console2.log("");
        console2.log("Roles, inventory, reserve and pool commit are done.");
        console2.log("  pack id       ", vm.toString(PACK_ID));
        console2.log("  price per rip  1 USDC");
        console2.log("Now run MODE=activate to schedule the pool version live.");
    }

    /// @dev Mints the cards to the deployer and deposits them into the vault under this pack. The
    ///      commitment is a stand-in for a real grading certificate hash — on a rehearsal there is no
    ///      certificate to bind, and inventing a realistic-looking one would misrepresent it.
    /// @param owner Must be the broadcasting key's address, passed in explicitly. `msg.sender` inside a
    ///        script body is the script's *caller* (forge's default sender), not the address the
    ///        transactions are broadcast from — so minting to `msg.sender` puts the cards in one
    ///        account while `setApprovalForAll` is signed by another, and the deposit then fails on an
    ///        approval that looks like it was just granted.
    function _seedInventory(Addrs memory a, address owner) internal {
        CollectibleNFT nft = CollectibleNFT(a.collectibleNFT);
        uint256[] memory ids = new uint256[](CARD_COUNT);
        bytes32[] memory commitments = new bytes32[](CARD_COUNT);
        for (uint256 i; i < CARD_COUNT; ++i) {
            ids[i] = i + 1;
            commitments[i] = keccak256(abi.encode("TESTNET-REHEARSAL-NOT-A-REAL-CERT", block.chainid, i + 1));
        }
        nft.mintBatch(owner, ids, commitments);
        nft.setApprovalForAll(a.vault, true);
        Vault(a.vault).depositBatch(ids, PACK_ID);
    }

    /// @dev `rip` books the worst case before it sells anything, so an unfunded reserve means no pack
    ///      can be opened at all. Funding is the deployer's own USDC — there is nothing to mint here.
    function _fundReserve(Addrs memory a, address payToken) internal {
        uint256 amount = vm.envUint("RESERVE_FUNDING");
        IERC20(payToken).approve(a.reserveVault, amount);
        ReserveVault(a.reserveVault).fund(payToken, amount);
    }

    function _commitPool(Addrs memory a, address payToken) internal {
        GachaMachine gacha = GachaMachine(a.gachaMachine);

        uint256[8] memory weights = [uint256(300), 250, 200, 120, 80, 30, 15, 5];
        uint256[8] memory priceRefs = [uint256(0.3e6), 0.4e6, 0.5e6, 0.6e6, 0.8e6, 1.2e6, 2e6, 3e6];

        PoolLib.Leaf[] memory leaves = new PoolLib.Leaf[](CARD_COUNT);
        uint256 cum;
        for (uint256 i; i < CARD_COUNT; ++i) {
            leaves[i] = PoolLib.Leaf({tokenId: i + 1, cumBefore: cum, weight: weights[i], priceRef: priceRefs[i]});
            cum += weights[i];
        }

        gacha.commitPool(
            PACK_ID,
            VERSION,
            PoolLib.PoolParams({
                pricePerRip: PRICE_PER_RIP,
                payToken: payToken,
                buybackBps: 8500,
                unavailableBps: 10_000,
                houseMarginBps: 1000,
                reserveBps: 4000,
                poolCID: keccak256("testnet-rehearsal-pool-v1")
            }),
            leaves
        );
        // Activation is deliberately NOT done here — see the `activate` branch in `run`.
    }
}

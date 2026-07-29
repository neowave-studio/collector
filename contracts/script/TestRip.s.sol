// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {GachaMachine} from "../src/GachaMachine.sol";
import {IPaymentRouter} from "../src/interfaces/IPaymentRouter.sol";

/**
 * Opens one pack against whatever VRF coordinator the deployment is configured with.
 *
 *   MODE=rip    forge script script/TestRip.s.sol:TestRip --rpc-url $RPC_URL --broadcast
 *   MODE=status forge script script/TestRip.s.sol:TestRip --rpc-url $RPC_URL
 *
 * The point of this script is narrow and worth stating: every other test in this repo answers the
 * VRF request itself, from a mock we wrote. This one requests randomness and then waits for
 * Chainlink's own nodes to answer. Until that round-trip completes on a public network, "Chainlink
 * VRF is integrated" is a claim about source code rather than an observed fact.
 *
 * Split into two modes because the answer does not arrive in the same transaction — the coordinator
 * calls back a few blocks later, and a script cannot wait.
 */
contract TestRip is Script {
    using stdJson for string;

    bytes32 internal constant PACK_ID = keccak256("collector.pack.elite.v1");

    function run() external {
        string memory key = vm.envString("CHAIN_KEY");
        string memory dep = vm.readFile(string.concat("deployments/", key, ".json"));
        GachaMachine gacha = GachaMachine(dep.readAddress(".gachaMachine"));
        address router = dep.readAddress(".paymentRouter");
        address payToken = vm.envAddress("PAY_TOKEN");

        if (keccak256(bytes(vm.envString("MODE"))) == keccak256("status")) {
            _status(gacha);
            return;
        }

        uint256 userPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        uint256 relayerPk = vm.envUint("RELAYER_PRIVATE_KEY");
        address user = vm.addr(userPk);

        uint256 version = gacha.activePoolVersion(PACK_ID);
        require(version != 0, "no active pool version yet - has the activation block passed?");

        GachaMachine.PurchaseAuth memory auth = GachaMachine.PurchaseAuth({
            user: user,
            packId: PACK_ID,
            poolVersion: version,
            numRips: 1,
            payToken: payToken,
            amountPerRip: gacha.getPoolVersion(PACK_ID, version).pricePerRip,
            nonce: gacha.nonces(user),
            deadline: uint48(block.timestamp + 1 hours)
        });

        // The user authorises the exact terms. The relayer can submit this and nothing else: it
        // cannot alter the price, the pack or the recipient without invalidating the signature.
        bytes32 structHash = keccak256(
            abi.encode(
                gacha.PURCHASE_AUTH_TYPEHASH(),
                auth.user,
                auth.packId,
                auth.poolVersion,
                auth.numRips,
                auth.payToken,
                auth.amountPerRip,
                auth.nonce,
                auth.deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", gacha.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPk, digest);
        bytes memory userSig = abi.encodePacked(r, s, v);

        // The user pays, so the user approves. Permit2 would avoid this hop where it is deployed;
        // the allowance fallback is what chains without it use, and is what runs here.
        vm.startBroadcast(userPk);
        IERC20(payToken).approve(router, auth.amountPerRip * auth.numRips);
        vm.stopBroadcast();

        vm.startBroadcast(relayerPk);
        uint256 drawId = gacha.rip(auth, userSig, IPaymentRouter.PaymentPermit({nonce: 0, deadline: 0, signature: ""}));
        vm.stopBroadcast();

        console2.log("");
        console2.log("Rip submitted. drawId %s", drawId);
        console2.log("Randomness has been REQUESTED from the coordinator, not yet delivered.");
        console2.log("Re-run with MODE=status until `revealed` flips to true.");
    }

    function _status(GachaMachine gacha) internal view {
        uint256 nextId = 1;
        // Walk forward to the newest draw rather than taking one on faith; there is no accessor for
        // the counter and a wrong id would report "not revealed" for a draw that does not exist.
        while (true) {
            (bool ok,) = _tryDraw(gacha, nextId + 1);
            if (!ok) break;
            ++nextId;
        }

        GachaMachine.Draw memory d = gacha.getDraw(nextId);
        console2.log("draw          %s", nextId);
        console2.log("  user        %s", d.user);
        console2.log("  revealed    %s", d.revealed);
        console2.log("  settled     %s", d.settled);
        console2.log("  winningWeight %s", d.winningWeight);
        if (d.revealed) {
            console2.log("");
            console2.log("CHAINLINK VRF DELIVERED. The winning weight above came from the coordinator.");
        }
    }

    function _tryDraw(GachaMachine gacha, uint256 id) internal view returns (bool ok, GachaMachine.Draw memory d) {
        try gacha.getDraw(id) returns (GachaMachine.Draw memory got) {
            return (got.user != address(0), got);
        } catch {
            return (false, d);
        }
    }
}

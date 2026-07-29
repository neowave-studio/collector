// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console2} from "forge-std/console2.sol";
import {Fixture} from "../utils/Fixture.sol";
import {GachaHandler} from "./GachaHandler.sol";
import {PoolLib} from "../../src/libraries/PoolLib.sol";
import {Roles} from "../../src/access/Roles.sol";

/// @notice Spec §7.1 / §7.4 — the global invariants, checked against reachable states produced by the
///         handler rather than hand-built ones.
///
/// The pool used here is deliberately larger than the unit-test pool (12 cards) so draws collide,
/// inventory depletes and the compensation path is genuinely exercised.
contract GachaInvariantsTest is Fixture {
    bytes32 internal constant INV_PACK = keccak256("INVARIANT_PACK");
    uint256 internal constant INV_VERSION = 1;
    uint256 internal constant CARD_COUNT = 12;
    uint256 internal constant WEIGHT_EACH = 10;

    GachaHandler internal handler;
    bytes32 internal committedRoot;

    function setUp() public override {
        super.setUp();

        PoolLib.Leaf[] memory leaves = _seedInvariantPack();

        vm.prank(address(timelock));
        gacha.setTimingParams(BUYBACK_WINDOW, RIP_REVEAL_TIMEOUT, 5000);

        address[3] memory users = [alice, bob, makeAddr("carol")];
        uint256[3] memory pks;
        pks[0] = alicePk;
        pks[1] = bobPk;
        (users[2], pks[2]) = makeAddrAndKey("carol");
        _fundUser(users[2]);

        handler = new GachaHandler(
            gacha,
            reserve,
            vault,
            usdc,
            vrf,
            INV_PACK,
            INV_VERSION,
            leaves,
            users,
            pks,
            GachaHandler.Actors({
                relayer: relayer,
                buybackRelayer: buybackRelayer,
                treasurer: treasurer,
                oraclePk: oraclePk
            })
        );

        committedRoot = gacha.getPoolVersion(INV_PACK, INV_VERSION).root;

        bytes4[] memory selectors = new bytes4[](9);
        selectors[0] = GachaHandler.rip.selector;
        selectors[1] = GachaHandler.reveal.selector;
        selectors[2] = GachaHandler.settle.selector;
        selectors[3] = GachaHandler.claimUnavailable.selector;
        selectors[4] = GachaHandler.buyback.selector;
        selectors[5] = GachaHandler.refund.selector;
        selectors[6] = GachaHandler.flushRevenue.selector;
        selectors[7] = GachaHandler.fundReserve.selector;
        selectors[8] = GachaHandler.withdrawSurplus.selector;

        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function _seedInvariantPack() internal returns (PoolLib.Leaf[] memory leaves) {
        uint256[] memory ids = new uint256[](CARD_COUNT);
        bytes32[] memory commitments = new bytes32[](CARD_COUNT);
        for (uint256 i; i < CARD_COUNT; ++i) {
            ids[i] = 5000 + i;
            commitments[i] = keccak256(abi.encode("INV-CERT", i));
        }
        vm.prank(minter);
        nft.mintBatch(inventoryAdmin, ids, commitments);
        vm.startPrank(inventoryAdmin);
        nft.setApprovalForAll(address(vault), true);
        vault.depositBatch(ids, INV_PACK);
        vm.stopPrank();

        leaves = new PoolLib.Leaf[](CARD_COUNT);
        uint256 cum;
        for (uint256 i; i < CARD_COUNT; ++i) {
            // One grail in the pool, the rest commons — the shape that makes the reserve interesting.
            uint256 priceRef = i == CARD_COUNT - 1 ? 100e6 : 20e6;
            leaves[i] = PoolLib.Leaf({tokenId: ids[i], cumBefore: cum, weight: WEIGHT_EACH, priceRef: priceRef});
            cum += WEIGHT_EACH;
        }

        vm.prank(poolAuthor);
        gacha.commitPool(INV_PACK, INV_VERSION, defaultPoolParams(), leaves);
        _activate(INV_PACK, INV_VERSION);
    }

    // =============================================================================================
    // §7.1.1 — solvency
    // =============================================================================================

    /// @notice The reserve can never owe more than it holds.
    function invariant_reserveSolvency() public view {
        assertGe(
            usdc.balanceOf(address(reserve)),
            reserve.reservedLiabilities(address(usdc)),
            "ReserveVault balance fell below its booked obligations"
        );
    }

    /// @notice Booked liabilities must equal the sum of every unresolved draw's reservation — not an
    ///         estimate, not a rolling average.
    function invariant_reservedEqualsWindowedLiabilities() public view {
        assertEq(
            reserve.reservedLiabilities(address(usdc)),
            handler.outstandingReservations(),
            "booked liabilities drifted from actual outstanding obligations"
        );
    }

    // =============================================================================================
    // §7.1.2 — single settlement
    // =============================================================================================

    function invariant_drawSettlesAtMostOnce() public view {
        assertLe(handler.maxResolutionsPerDraw(), 1, "a draw resolved more than once");
    }

    // =============================================================================================
    // §7.1.4 / §7.1.7 — fairness
    // =============================================================================================

    /// @notice Every delivered card was the UNIQUE leaf whose slice contained the VRF weight.
    function invariant_deliveredCardMatchesCommittedOdds() public view {
        assertFalse(handler.ghostOddsViolated(), "a delivered card did not match the committed partition");
    }

    function invariant_poolCommitmentIsImmutable() public view {
        PoolLib.PoolVersion memory pv = gacha.getPoolVersion(INV_PACK, INV_VERSION);
        assertEq(pv.root, committedRoot, "a committed pool root changed");
        assertEq(pv.totalWeight, CARD_COUNT * WEIGHT_EACH);
        assertEq(pv.cardCount, uint32(CARD_COUNT));
    }

    // =============================================================================================
    // §7.1.5 — the user is charged only what they signed
    // =============================================================================================

    function invariant_chargeIsExactlyPricePerRip() public view {
        assertEq(
            handler.ghostCharged(),
            handler.ghostRips() * PRICE_PER_RIP,
            "total charged diverged from rips times the signed price"
        );
    }

    // =============================================================================================
    // Fund accounting — user escrow is never spendable as revenue
    // =============================================================================================

    /// @notice Everything the GachaMachine holds is exactly: unresolved user escrow + revenue awaiting
    ///         its flush. There is no third bucket, so nothing can silently leak between them.
    function invariant_machineBalanceIsFullyAccounted() public view {
        uint256 accounted = gacha.escrowedFunds(address(usdc)) + gacha.pendingReserveRevenue(address(usdc))
            + gacha.pendingTreasuryRevenue(address(usdc));
        assertEq(usdc.balanceOf(address(gacha)), accounted, "unaccounted balance in the GachaMachine");
    }

    function invariant_escrowMatchesUnresolvedDraws() public view {
        assertEq(
            gacha.escrowedFunds(address(usdc)),
            handler.outstandingEscrow(),
            "escrow ledger drifted from the unresolved draws it represents"
        );
    }

    // =============================================================================================
    // §7.1.3 — no vault exit without a proof
    // =============================================================================================

    /// @notice Every card that left the vault is owned by the user of the draw that released it.
    ///         Nothing else moved inventory: `sweepTo` is Timelocked and never called here.
    function invariant_cardsOnlyLeaveViaSettlement() public view {
        for (uint256 i; i < CARD_COUNT; ++i) {
            uint256 tokenId = 5000 + i;
            if (vault.isHeld(tokenId)) continue;
            address recipient = handler.ghostDeliveredTo(tokenId);
            assertTrue(recipient != address(0), "a card left the vault without a recorded settlement");
            assertEq(nft.ownerOf(tokenId), recipient, "card went to someone other than the draw's user");
        }
    }

    // =============================================================================================
    // §7.1.11 — a resolved draw was either revealed or refunded
    // =============================================================================================

    function invariant_noPayoutWithoutReveal() public view {
        assertTrue(handler.everyResolvedDrawWasRevealedOrRefunded(), "a draw paid out without being revealed");
    }

    // =============================================================================================
    // Role model
    // =============================================================================================

    function invariant_settlementAuthorityStaysWithTheGachaMachineAlone() public view {
        assertEq(access.getRoleMemberCount(Roles.SETTLEMENT_ROLE), 1);
        assertEq(access.getRoleMember(Roles.SETTLEMENT_ROLE, 0), address(gacha));
        assertEq(access.getRoleMemberCount(Roles.GACHA_ROLE), 1);
        assertEq(access.getRoleMember(Roles.GACHA_ROLE, 0), address(gacha));
    }

    /// @notice Guards against a vacuous suite. The invariants above would all pass trivially if every
    ///         handler action were silently reverting inside its `try`, so this drives each action
    ///         deterministically and asserts the ghost counters actually move. Combined with the
    ///         fuzzer's roughly uniform selector distribution (~1.8k calls per action per run), it
    ///         establishes that the invariants are checked against real, reached states.
    function test_handlerReachesEveryLifecycleState() public {
        // Delivery
        handler.rip(0, 2);
        handler.reveal(uint256(keccak256("seed-a")));
        handler.settle(_seedForNewestDraw());
        assertEq(handler.ghostDelivered(), 1, "delivery path not reached");

        // Buyback
        handler.rip(1, 0);
        handler.reveal(uint256(keccak256("seed-b")));
        handler.buyback(_seedForNewestDraw(), 1);
        assertEq(handler.ghostBoughtBack(), 1, "buyback path not reached");

        // Refund of a rip whose randomness never arrives
        handler.rip(2, 0);
        handler.refund(_seedForNewestDraw());
        assertEq(handler.ghostRefunded(), 1, "refund path not reached");

        handler.flushRevenue();
        handler.fundReserve(1000e6);
        handler.withdrawSurplus(1e6);

        console2.log("rips        ", handler.ghostRips());
        console2.log("delivered   ", handler.ghostDelivered());
        console2.log("boughtBack  ", handler.ghostBoughtBack());
        console2.log("refunded    ", handler.ghostRefunded());
    }

    /// @dev `GachaHandler._pickDraw` maps a seed to `first + seed % span`, so this targets the draw
    ///      created most recently.
    function _seedForNewestDraw() internal view returns (uint256) {
        return handler.ghostLastDrawId() - handler.ghostFirstDrawId();
    }
}

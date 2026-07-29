// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixture} from "../utils/Fixture.sol";
import {AccessController} from "../../src/access/AccessController.sol";
import {ReserveVault} from "../../src/ReserveVault.sol";
import {GachaMachine} from "../../src/GachaMachine.sol";
import {Marketplace} from "../../src/Marketplace.sol";
import {Vault} from "../../src/Vault.sol";
import {Roles} from "../../src/access/Roles.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @notice Spec §6 — "a lot of control, done safely". Proves the split between instant operational
///         powers and Timelock-gated value-extracting powers is real, not documentation.
contract AccessAndTimelockTest is Fixture {
    // =============================================================================================
    // Role model
    // =============================================================================================

    function test_defaultAdminIsTheTimelockAndNotAnEOA() public view {
        assertTrue(access.hasRole(Roles.DEFAULT_ADMIN_ROLE, address(timelock)));
        assertFalse(access.hasRole(Roles.DEFAULT_ADMIN_ROLE, safe));
        assertFalse(access.hasRole(Roles.DEFAULT_ADMIN_ROLE, ops));
        assertEq(access.getRoleMemberCount(Roles.DEFAULT_ADMIN_ROLE), 1);
    }

    /// @notice Spec §4 invariant: the Vault's only settlement authority, and the ReserveVault's only
    ///         liability authority, is the GachaMachine.
    function test_settlementAndGachaRolesAreHeldOnlyByTheGachaMachine() public view {
        assertEq(access.getRoleMemberCount(Roles.SETTLEMENT_ROLE), 1);
        assertEq(access.getRoleMember(Roles.SETTLEMENT_ROLE, 0), address(gacha));
        assertEq(access.getRoleMemberCount(Roles.GACHA_ROLE), 1);
        assertEq(access.getRoleMember(Roles.GACHA_ROLE, 0), address(gacha));
    }

    function test_operationsCanRotateHotKeysInstantly() public {
        address newRelayer = makeAddr("newRelayer");
        vm.startPrank(ops);
        access.revokeRole(Roles.TRUSTED_RELAYER_ROLE, relayer);
        access.grantRole(Roles.TRUSTED_RELAYER_ROLE, newRelayer);
        vm.stopPrank();

        assertFalse(access.hasRole(Roles.TRUSTED_RELAYER_ROLE, relayer));
        assertTrue(access.hasRole(Roles.TRUSTED_RELAYER_ROLE, newRelayer));
    }

    /// @notice A compromised ops key must not be able to promote itself to an admin role.
    function test_operationsCannotGrantPrivilegedRoles() public {
        vm.prank(ops);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, ops, Roles.DEFAULT_ADMIN_ROLE
            )
        );
        access.grantRole(Roles.TREASURER_ROLE, ops);
    }

    function test_roleRevocationTakesEffectImmediatelyEverywhere() public {
        vm.prank(ops);
        access.revokeRole(Roles.TRUSTED_RELAYER_ROLE, relayer);

        GachaMachine.PurchaseAuth memory auth = purchaseAuth(alice, 1);
        bytes memory sig = signPurchase(alicePk, auth);
        vm.prank(relayer);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, relayer, Roles.TRUSTED_RELAYER_ROLE
            )
        );
        gacha.rip(auth, sig, emptyPermit());
    }

    function test_lastAdminCannotBeRemoved() public {
        vm.prank(address(timelock));
        vm.expectRevert(AccessController.LastAdminCannotBeRemoved.selector);
        access.revokeRole(Roles.DEFAULT_ADMIN_ROLE, address(timelock));
    }

    // =============================================================================================
    // Timelock gating — the real propose → wait → execute path
    // =============================================================================================

    function _schedule(address target, bytes memory data) internal returns (bytes32 id) {
        id = timelock.hashOperation(target, 0, data, bytes32(0), bytes32(0));
        vm.prank(safe);
        timelock.schedule(target, 0, data, bytes32(0), bytes32(0), TIMELOCK_DELAY);
    }

    function _execute(address target, bytes memory data) internal {
        vm.prank(safe);
        timelock.execute(target, 0, data, bytes32(0), bytes32(0));
    }

    function test_surplusWithdrawalCannotExecuteBeforeTheDelayElapses() public {
        bytes memory data =
            abi.encodeCall(ReserveVault.withdrawSurplus, (address(usdc), 1_000e6, treasury));
        _schedule(address(reserve), data);

        skip(TIMELOCK_DELAY - 1);
        vm.prank(safe);
        vm.expectRevert();
        timelock.execute(address(reserve), 0, data, bytes32(0), bytes32(0));

        skip(2);
        uint256 before = usdc.balanceOf(treasury);
        _execute(address(reserve), data);
        assertEq(usdc.balanceOf(treasury) - before, 1_000e6, "executes only after the public 48h window");
    }

    function test_upgradeRequiresTheTimelock() public {
        address newImpl = address(new GachaMachine());

        vm.prank(ops);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, ops, Roles.DEFAULT_ADMIN_ROLE
            )
        );
        UUPSUpgradeable(address(gacha)).upgradeToAndCall(newImpl, "");

        bytes memory data = abi.encodeCall(UUPSUpgradeable.upgradeToAndCall, (newImpl, ""));
        _schedule(address(gacha), data);
        skip(TIMELOCK_DELAY + 1);
        _execute(address(gacha), data);

        // State survived the upgrade.
        assertEq(gacha.activePoolVersion(PACK), VERSION);
        assertEq(gacha.getPoolVersion(PACK, VERSION).cardCount, 4);
    }

    function test_treasuryChangeRequiresTheTimelock() public {
        vm.prank(ops);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, ops, Roles.DEFAULT_ADMIN_ROLE
            )
        );
        gacha.setTreasury(ops);

        vm.prank(address(timelock));
        gacha.setTreasury(ops);
        assertEq(gacha.treasury(), ops);
    }

    function test_payTokenAllowlistIsTokenAdminOnly() public {
        vm.prank(ops);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, ops, Roles.TOKEN_ADMIN_ROLE
            )
        );
        router.setAllowedPayToken(address(0xfeed), true);
    }

    // =============================================================================================
    // Blanket unauthorized-caller sweep
    // =============================================================================================

    /// @notice Every privileged selector must reject a caller holding no roles at all. This is the
    ///         cheap net that catches a future function shipped without a modifier.
    function test_randomCallerIsRejectedByEveryPrivilegedEntryPoint() public {
        address nobody = makeAddr("nobody");
        vm.startPrank(nobody);

        vm.expectRevert();
        gacha.setTreasury(nobody);
        vm.expectRevert();
        gacha.setTimingParams(1 hours, 1 hours, 1000);
        vm.expectRevert();
        gacha.setBuybackLock(alice, uint64(block.timestamp + 1));
        vm.expectRevert();
        gacha.setVRFCoordinator(address(vrf), 1, false);
        vm.expectRevert();
        gacha.setVRFOperationalConfig(bytes32("x"), 1, 1);
        vm.expectRevert();
        gacha.pause();
        vm.expectRevert();
        gacha.commitPoolStart(PACK, 99, defaultPoolParams());
        vm.expectRevert();
        gacha.setActivePoolVersion(PACK, VERSION, uint64(block.number + 100));

        vm.expectRevert();
        reserve.fund(address(usdc), 1);
        vm.expectRevert();
        reserve.withdrawSurplus(address(usdc), 1, nobody);
        vm.expectRevert();
        reserve.setMaxBuybackOutflow(address(usdc), 1);
        vm.expectRevert();
        reserve.setSurplusBufferBps(1000);
        vm.expectRevert();
        reserve.reserve(address(usdc), 1);
        vm.expectRevert();
        reserve.contribute(address(usdc), 1);

        vm.expectRevert();
        vault.releaseTo(nobody, 1, PACK);
        vm.expectRevert();
        vault.sweepTo(nobody, 1);
        vm.expectRevert();
        vault.setGachaMachine(nobody);

        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;
        vm.expectRevert();
        vault.depositBatch(ids, PACK);
        vm.expectRevert();
        vault.assignPack(ids, PACK);

        vm.expectRevert();
        nft.mint(nobody, 500, keccak256("x"));
        vm.expectRevert();
        nft.setBaseURI("evil://");
        vm.expectRevert();
        nft.setDefaultRoyalty(nobody, 10_000);
        vm.expectRevert();
        nft.setTransferLock(1, uint64(block.timestamp + 1));

        vm.expectRevert();
        market.setFeeBps(0);
        vm.expectRevert();
        market.setFeeRecipient(nobody);

        vm.expectRevert();
        router.setAllowedPayToken(address(usdc), false);
        vm.expectRevert();
        router.setPermit2(nobody);
        vm.expectRevert();
        router.collectForRip(alice, address(usdc), 1, nobody, PACK, VERSION, 1, emptyPermit());
        vm.expectRevert();
        router.collectForOrder(alice, address(usdc), 1, nobody, bytes32(0), emptyPermit());

        vm.stopPrank();
    }

    /// @notice The PaymentRouter is the one contract that can move a user's allowance, so an
    ///         unauthorised caller must never reach it — this is the concrete drain it prevents.
    function test_paymentRouterCannotBeUsedToStealAnApprovedAllowance() public {
        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, bob, Roles.PAYMENT_CONSUMER_ROLE
            )
        );
        router.collectForRip(alice, address(usdc), 500e6, bob, PACK, VERSION, 1, emptyPermit());
        assertEq(usdc.balanceOf(alice), aliceBefore);
    }
}

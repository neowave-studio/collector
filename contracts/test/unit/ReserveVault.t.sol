// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixture} from "../utils/Fixture.sol";
import {ReserveVault} from "../../src/ReserveVault.sol";
import {Roles} from "../../src/access/Roles.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

/// @notice Spec §5.5 / §7.1.1 — the reserve must never be able to promise more than it holds, and the
///         operator must never be able to take value that is spoken for.
contract ReserveVaultTest is Fixture {
    function _reserved() internal view returns (uint256) {
        return reserve.reservedLiabilities(address(usdc));
    }

    function _balance() internal view returns (uint256) {
        return usdc.balanceOf(address(reserve));
    }

    function test_proofOfReservesReportsWindowedObligations() public {
        doRip(alice, alicePk, 2);
        (uint256 balance, uint256 reserved, int256 surplus) = reserve.proofOfReserves(address(usdc));
        assertEq(reserved, 2 * 800e6, "unexercised obligations must still be shown");
        assertEq(balance, _balance());
        assertEq(surplus, int256(balance) - int256(reserved));
    }

    function test_reserveRevertsIfItWouldMakeTheVaultInsolvent() public {
        uint256 drain = _balance() - 10e6;
        vm.prank(address(timelock));
        reserve.withdrawSurplus(address(usdc), drain, treasurer);

        vm.prank(address(gacha));
        vm.expectRevert(abi.encodeWithSelector(ReserveVault.InsufficientReserve.selector, address(usdc), 10e6, 50e6));
        reserve.reserve(address(usdc), 50e6);
    }

    function test_withdrawSurplusMustLeaveObligationsPlusBuffer() public {
        doRip(alice, alicePk, 1);
        uint256 reserved = _reserved();
        uint256 required = reserved * (10_000 + reserve.surplusBufferBps()) / 10_000;
        uint256 balance = _balance();
        uint256 tooMuch = balance - required + 1;

        vm.prank(address(timelock));
        vm.expectRevert(
            abi.encodeWithSelector(
                ReserveVault.InsufficientReserve.selector, address(usdc), balance, tooMuch + required
            )
        );
        reserve.withdrawSurplus(address(usdc), tooMuch, treasurer);

        vm.prank(address(timelock));
        reserve.withdrawSurplus(address(usdc), tooMuch - 1, treasurer);
        assertGe(_balance(), required, "buffer preserved");
    }

    /// @notice Fail-closed: an operator who forgets to configure the circuit breaker gets no buyback
    ///         outflow at all, rather than an unlimited one.
    function test_unconfiguredOutflowCapBlocksAllPayouts() public {
        MockERC20 other = new MockERC20("Other", "OTH", 6);
        vm.prank(tokenAdmin);
        router.setAllowedPayToken(address(other), true);

        other.mint(treasurer, 1000e6);
        vm.startPrank(treasurer);
        other.approve(address(reserve), type(uint256).max);
        reserve.fund(address(other), 1000e6);
        vm.stopPrank();

        vm.prank(address(gacha));
        reserve.reserve(address(other), 100e6);

        vm.prank(address(gacha));
        vm.expectRevert(abi.encodeWithSelector(ReserveVault.OutflowCapNotConfigured.selector, address(other)));
        reserve.payFromReservation(address(other), alice, 10e6, 100e6);
    }

    function test_outflowAllowanceRefreshesEachEpoch() public {
        vm.prank(address(timelock));
        reserve.setMaxBuybackOutflow(address(usdc), 100e6);

        vm.startPrank(address(gacha));
        reserve.reserve(address(usdc), 100e6);
        reserve.payFromReservation(address(usdc), alice, 100e6, 100e6);
        assertEq(reserve.outflowRemaining(address(usdc)), 0);

        reserve.reserve(address(usdc), 100e6);
        vm.expectRevert(
            abi.encodeWithSelector(ReserveVault.OutflowCapExceeded.selector, address(usdc), 100e6, 0)
        );
        reserve.payFromReservation(address(usdc), alice, 100e6, 100e6);
        vm.stopPrank();

        skip(1 days);
        assertEq(reserve.outflowRemaining(address(usdc)), 100e6, "a fresh epoch restores the allowance");
        vm.prank(address(gacha));
        reserve.payFromReservation(address(usdc), alice, 100e6, 100e6);
    }

    function test_payoutCannotExceedItsOwnReservation() public {
        vm.startPrank(address(gacha));
        reserve.reserve(address(usdc), 100e6);
        vm.expectRevert(abi.encodeWithSelector(ReserveVault.PayoutExceedsReservation.selector, 101e6, 100e6));
        reserve.payFromReservation(address(usdc), alice, 101e6, 100e6);
        vm.stopPrank();
    }

    function test_unreserveCannotUnderflowLiabilities() public {
        vm.prank(address(gacha));
        reserve.reserve(address(usdc), 100e6);

        // Releasing more than was ever booked would silently create phantom surplus — it must revert.
        vm.prank(address(gacha));
        vm.expectRevert();
        reserve.unreserve(address(usdc), 101e6);
    }

    function test_unusedReservationRemainderReturnsToSurplus() public {
        vm.startPrank(address(gacha));
        reserve.reserve(address(usdc), 800e6);
        reserve.payFromReservation(address(usdc), alice, 100e6, 800e6);
        vm.stopPrank();
        assertEq(_reserved(), 0, "the whole reservation is discharged, not just the paid part");
    }

    /// @notice The gate is split by FUNCTION, not by role. Whoever can top the reserve up at 3am must
    ///         NOT be able to drain its surplus with the same key, or "withdrawal is Timelocked" would
    ///         be a procedure rather than a property.
    function test_treasurerMayFundButNeverWithdraw() public {
        usdc.mint(treasurer, 1_000e6);

        vm.startPrank(treasurer);
        usdc.approve(address(reserve), type(uint256).max);
        reserve.fund(address(usdc), 1_000e6); // instant, by design

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, treasurer, Roles.DEFAULT_ADMIN_ROLE
            )
        );
        reserve.withdrawSurplus(address(usdc), 1e6, treasurer);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, treasurer, Roles.DEFAULT_ADMIN_ROLE
            )
        );
        reserve.setMaxBuybackOutflow(address(usdc), type(uint256).max);
        vm.stopPrank();
    }

    function test_onlyGachaMayTouchLiabilities() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, alice, Roles.GACHA_ROLE
            )
        );
        reserve.reserve(address(usdc), 1);

        vm.prank(treasurer);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, treasurer, Roles.GACHA_ROLE
            )
        );
        reserve.payFromReservation(address(usdc), treasurer, 1, 1);
    }

    function test_pausingStopsPayoutsAndNewReservationsButNotReleases() public {
        vm.prank(address(gacha));
        reserve.reserve(address(usdc), 100e6);

        vm.prank(pauser);
        reserve.pause();

        vm.prank(address(gacha));
        vm.expectRevert();
        reserve.reserve(address(usdc), 1e6);

        vm.prank(address(gacha));
        vm.expectRevert();
        reserve.payFromReservation(address(usdc), alice, 1e6, 100e6);

        // Releasing an obligation must keep working: the delivery path runs through it, and pausing
        // must never strand a paid user.
        vm.prank(address(gacha));
        reserve.unreserve(address(usdc), 100e6);
        assertEq(_reserved(), 0);
    }

    function test_configurationBoundsAreEnforced() public {
        vm.startPrank(address(timelock));
        vm.expectRevert(abi.encodeWithSelector(ReserveVault.SurplusBufferOutOfRange.selector, uint16(100)));
        reserve.setSurplusBufferBps(100);
        vm.expectRevert(abi.encodeWithSelector(ReserveVault.EpochDurationOutOfRange.selector, uint64(1 minutes)));
        reserve.setEpochDuration(1 minutes);
        vm.stopPrank();
    }

    function testFuzz_solvencyHoldsAcrossArbitraryReserveAndReleaseSequences(uint96[8] calldata amounts) public {
        for (uint256 i; i < amounts.length; ++i) {
            // At least 2 so the `amount / 2` payout below is never zero (zero payouts are rejected
            // outright — a no-op transfer would only muddy the ledger).
            uint256 amount = uint256(amounts[i]) % 1_000e6 + 2;
            vm.prank(address(gacha));
            reserve.reserve(address(usdc), amount);
            assertGe(_balance(), _reserved(), "solvency broken after reserve");

            if (i % 2 == 0) {
                vm.prank(address(gacha));
                reserve.unreserve(address(usdc), amount);
            } else {
                vm.prank(address(gacha));
                reserve.payFromReservation(address(usdc), alice, amount / 2, amount);
            }
            assertGe(_balance(), _reserved(), "solvency broken after release");
        }
    }
}

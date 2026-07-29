// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";

import {GachaMachine} from "../../src/GachaMachine.sol";
import {ReserveVault} from "../../src/ReserveVault.sol";
import {Vault} from "../../src/Vault.sol";
import {PoolLib} from "../../src/libraries/PoolLib.sol";
import {IPaymentRouter} from "../../src/interfaces/IPaymentRouter.sol";
import {MerkleHelper} from "../utils/MerkleHelper.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockVRFCoordinator} from "../mocks/MockVRFCoordinator.sol";

/// @notice Drives the whole gacha lifecycle under the invariant fuzzer and records ghost state that
///         the invariants in `GachaInvariants.t.sol` assert against.
///
/// @dev The handler deliberately performs every action the way a real participant would — the relayer
///      submits rips, the coordinator delivers randomness, anyone may settle — so the invariants are
///      being checked against reachable states, not synthetic ones.
contract GachaHandler is CommonBase, StdCheats, StdUtils {
    struct Actors {
        address relayer;
        address buybackRelayer;
        address treasurer;
        uint256 oraclePk;
    }

    GachaMachine public immutable gacha;
    ReserveVault public immutable reserve;
    Vault public immutable vault;
    MockERC20 public immutable usdc;
    MockVRFCoordinator public immutable vrf;

    bytes32 public immutable packId;
    uint256 public immutable version;

    Actors internal actors;
    address[3] public users;
    uint256[3] public userPks;

    PoolLib.Leaf[] internal leaves;
    bytes32[] internal hashes;

    // --- ghost state --------------------------------------------------------------------------
    uint256 public ghostRips;
    uint256 public ghostCharged;
    uint256 public ghostDelivered;
    uint256 public ghostBoughtBack;
    uint256 public ghostCompensated;
    uint256 public ghostRefunded;
    uint256 public ghostPayoutTotal;
    uint256 public ghostFirstDrawId;
    uint256 public ghostLastDrawId;

    mapping(uint256 drawId => uint8) public ghostResolutions;
    mapping(uint256 drawId => bool) public ghostWasRevealedBeforeResolution;
    mapping(uint256 tokenId => address) public ghostDeliveredTo;
    /// @notice Set when a delivered card did NOT match the unique leaf containing its winning weight.
    bool public ghostOddsViolated;

    uint256 internal pendingRequestId;

    constructor(
        GachaMachine gacha_,
        ReserveVault reserve_,
        Vault vault_,
        MockERC20 usdc_,
        MockVRFCoordinator vrf_,
        bytes32 packId_,
        uint256 version_,
        PoolLib.Leaf[] memory leaves_,
        address[3] memory users_,
        uint256[3] memory userPks_,
        Actors memory actors_
    ) {
        gacha = gacha_;
        reserve = reserve_;
        vault = vault_;
        usdc = usdc_;
        vrf = vrf_;
        packId = packId_;
        version = version_;
        users = users_;
        userPks = userPks_;
        actors = actors_;

        for (uint256 i; i < leaves_.length; ++i) {
            leaves.push(leaves_[i]);
            hashes.push(PoolLib.leafHash(packId_, version_, i, leaves_[i]));
        }
    }

    // =============================================================================================
    // Actions
    // =============================================================================================

    function rip(uint256 userSeed, uint256 countSeed) external {
        uint256 idx = userSeed % users.length;
        uint96 numRips = uint96(bound(countSeed, 1, 3));

        GachaMachine.PurchaseAuth memory auth = GachaMachine.PurchaseAuth({
            user: users[idx],
            packId: packId,
            poolVersion: version,
            numRips: numRips,
            payToken: address(usdc),
            amountPerRip: gacha.getPoolVersion(packId, version).pricePerRip,
            nonce: gacha.nonces(users[idx]),
            deadline: uint48(block.timestamp + 1 hours)
        });

        bytes memory sig = _sign(userPks[idx], _gachaDigest(_purchaseStructHash(auth)));

        vm.prank(actors.relayer);
        try gacha.rip(auth, sig, _noPermit()) returns (uint256 firstDrawId) {
            if (ghostFirstDrawId == 0) ghostFirstDrawId = firstDrawId;
            ghostLastDrawId = firstDrawId + numRips - 1;
            ghostRips += numRips;
            ghostCharged += uint256(auth.amountPerRip) * numRips;
            pendingRequestId = vrf.nextRequestId() - 1;
        } catch {}
    }

    function reveal(uint256 wordSeed) external {
        uint256 requestId = pendingRequestId;
        if (requestId == 0) return;
        pendingRequestId = 0;

        uint32 count = vrf.numWordsOf(requestId);
        if (count == 0) return;

        uint256[] memory words = new uint256[](count);
        for (uint256 i; i < count; ++i) {
            words[i] = uint256(keccak256(abi.encode(wordSeed, i)));
        }
        try vrf.fulfill(requestId, words) {} catch {}
    }

    function settle(uint256 drawSeed) external {
        uint256 drawId = _pickDraw(drawSeed);
        if (drawId == 0) return;
        GachaMachine.Draw memory d = gacha.getDraw(drawId);
        if (!d.revealed || d.settled) return;

        GachaMachine.LeafProof memory proof = _proofForWeight(d.winningWeight);
        bool revealedBefore = d.revealed;

        vm.warp(block.timestamp + gacha.buybackWindow() + 1);
        try gacha.settle(drawId, proof) {
            ghostResolutions[drawId] += 1;
            ghostWasRevealedBeforeResolution[drawId] = revealedBefore;
            ghostDelivered += 1;
            ghostDeliveredTo[proof.tokenId] = d.user;
            if (!_leafIsUniqueMatch(d.winningWeight, proof)) ghostOddsViolated = true;
        } catch {}
    }

    function claimUnavailable(uint256 drawSeed) external {
        uint256 drawId = _pickDraw(drawSeed);
        if (drawId == 0) return;
        GachaMachine.Draw memory d = gacha.getDraw(drawId);
        if (!d.revealed || d.settled) return;

        GachaMachine.LeafProof memory proof = _proofForWeight(d.winningWeight);
        uint256 before = usdc.balanceOf(d.user);
        try gacha.claimUnavailable(drawId, proof) {
            ghostResolutions[drawId] += 1;
            ghostWasRevealedBeforeResolution[drawId] = true;
            ghostCompensated += 1;
            ghostPayoutTotal += usdc.balanceOf(d.user) - before;
        } catch {}
    }

    function buyback(uint256 drawSeed, uint256 payoutSeed) external {
        uint256 drawId = _pickDraw(drawSeed);
        if (drawId == 0) return;
        GachaMachine.Draw memory d = gacha.getDraw(drawId);
        if (!d.revealed || d.settled) return;

        GachaMachine.LeafProof memory proof = _proofForWeight(d.winningWeight);
        uint256 cap = proof.priceRef * gacha.getPoolVersion(packId, version).buybackBps / 10_000;
        if (cap == 0) return;

        GachaMachine.BuybackAuth memory auth = GachaMachine.BuybackAuth({
            drawId: drawId,
            payToken: address(usdc),
            payout: bound(payoutSeed, 1, cap),
            nonce: gacha.nonces(d.user),
            deadline: uint48(block.timestamp + 1 hours)
        });

        uint256 pk = _pkFor(d.user);
        if (pk == 0) return;

        bytes memory userSig = _sign(pk, _gachaDigest(_buybackStructHash(gacha.BUYBACK_USER_TYPEHASH(), auth)));
        bytes memory oracleSig =
            _sign(actors.oraclePk, _gachaDigest(_buybackStructHash(gacha.BUYBACK_AUTH_TYPEHASH(), auth)));

        uint256 before = usdc.balanceOf(d.user);
        vm.prank(actors.buybackRelayer);
        try gacha.settleBuyback(drawId, auth, userSig, oracleSig, proof) {
            ghostResolutions[drawId] += 1;
            ghostWasRevealedBeforeResolution[drawId] = true;
            ghostBoughtBack += 1;
            ghostPayoutTotal += usdc.balanceOf(d.user) - before;
        } catch {}
    }

    function refund(uint256 drawSeed) external {
        uint256 drawId = _pickDraw(drawSeed);
        if (drawId == 0) return;
        GachaMachine.Draw memory d = gacha.getDraw(drawId);
        if (d.settled || d.revealed) return;

        vm.warp(block.timestamp + gacha.ripRevealTimeout() + 1);
        try gacha.refundStuckRip(drawId) {
            ghostResolutions[drawId] += 1;
            ghostRefunded += 1;
        } catch {}
    }

    function flushRevenue() external {
        try gacha.flushRevenue(address(usdc)) {} catch {}
    }

    function fundReserve(uint256 amountSeed) external {
        uint256 amount = bound(amountSeed, 1e6, 100_000e6);
        deal(address(usdc), actors.treasurer, amount);
        vm.startPrank(actors.treasurer);
        usdc.approve(address(reserve), amount);
        try reserve.fund(address(usdc), amount) {} catch {}
        vm.stopPrank();
    }

    function withdrawSurplus(uint256 amountSeed) external {
        uint256 balance = usdc.balanceOf(address(reserve));
        if (balance == 0) return;
        uint256 amount = bound(amountSeed, 1, balance);
        vm.prank(actors.treasurer);
        try reserve.withdrawSurplus(address(usdc), amount, actors.treasurer) {} catch {}
    }

    function warp(uint256 secondsSeed) external {
        vm.warp(block.timestamp + bound(secondsSeed, 1 minutes, 2 days));
    }

    // =============================================================================================
    // Views used by the invariants
    // =============================================================================================

    /// @notice Σ of `reservedAmount` over every draw that has not resolved. The ReserveVault's booked
    ///         liabilities must equal exactly this.
    function outstandingReservations() external view returns (uint256 total) {
        if (ghostFirstDrawId == 0) return 0;
        for (uint256 id = ghostFirstDrawId; id <= ghostLastDrawId; ++id) {
            GachaMachine.Draw memory d = gacha.getDraw(id);
            if (d.user != address(0) && !d.settled) total += d.reservedAmount;
        }
    }

    function outstandingEscrow() external view returns (uint256 total) {
        if (ghostFirstDrawId == 0) return 0;
        for (uint256 id = ghostFirstDrawId; id <= ghostLastDrawId; ++id) {
            GachaMachine.Draw memory d = gacha.getDraw(id);
            if (d.user != address(0) && !d.settled) total += d.escrow;
        }
    }

    function maxResolutionsPerDraw() external view returns (uint8 worst) {
        if (ghostFirstDrawId == 0) return 0;
        for (uint256 id = ghostFirstDrawId; id <= ghostLastDrawId; ++id) {
            if (ghostResolutions[id] > worst) worst = ghostResolutions[id];
        }
    }

    function everyResolvedDrawWasRevealedOrRefunded() external view returns (bool) {
        if (ghostFirstDrawId == 0) return true;
        for (uint256 id = ghostFirstDrawId; id <= ghostLastDrawId; ++id) {
            GachaMachine.Draw memory d = gacha.getDraw(id);
            // A settled draw either got its card / payout (and so must have been revealed) or was
            // refunded while unrevealed. It can never be settled-and-unrevealed with a payout.
            if (d.settled && !d.revealed && !ghostWasRevealedBeforeResolution[id]) {
                // refund path — escrow must have been returned, never a reserve payout
                continue;
            }
            if (d.settled && !d.revealed && ghostWasRevealedBeforeResolution[id]) return false;
        }
        return true;
    }

    // =============================================================================================
    // Internals
    // =============================================================================================

    function _pickDraw(uint256 seed) internal view returns (uint256) {
        if (ghostFirstDrawId == 0 || ghostLastDrawId < ghostFirstDrawId) return 0;
        uint256 span = ghostLastDrawId - ghostFirstDrawId + 1;
        return ghostFirstDrawId + (seed % span);
    }

    function _pkFor(address user) internal view returns (uint256) {
        for (uint256 i; i < users.length; ++i) {
            if (users[i] == user) return userPks[i];
        }
        return 0;
    }

    function _proofForWeight(uint256 weight) internal view returns (GachaMachine.LeafProof memory) {
        for (uint256 i; i < leaves.length; ++i) {
            if (weight >= leaves[i].cumBefore && weight < leaves[i].cumBefore + leaves[i].weight) {
                return GachaMachine.LeafProof({
                    tokenId: leaves[i].tokenId,
                    cumBefore: leaves[i].cumBefore,
                    weight: leaves[i].weight,
                    priceRef: leaves[i].priceRef,
                    leafIndex: i,
                    proof: MerkleHelper.buildProof(hashes, i)
                });
            }
        }
        revert("no slice");
    }

    /// @dev Re-derives, independently of the contract, which card the committed odds say this weight
    ///      must produce — and asserts exactly one leaf qualifies.
    function _leafIsUniqueMatch(uint256 weight, GachaMachine.LeafProof memory proof)
        internal
        view
        returns (bool)
    {
        uint256 matches;
        uint256 matchedTokenId;
        for (uint256 i; i < leaves.length; ++i) {
            if (weight >= leaves[i].cumBefore && weight < leaves[i].cumBefore + leaves[i].weight) {
                matches += 1;
                matchedTokenId = leaves[i].tokenId;
            }
        }
        return matches == 1 && matchedTokenId == proof.tokenId;
    }

    function _noPermit() internal pure returns (IPaymentRouter.PaymentPermit memory) {
        return IPaymentRouter.PaymentPermit({nonce: 0, deadline: 0, signature: ""});
    }

    function _gachaDigest(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", gacha.domainSeparator(), structHash));
    }

    function _purchaseStructHash(GachaMachine.PurchaseAuth memory auth) internal view returns (bytes32) {
        return keccak256(
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
    }

    function _buybackStructHash(bytes32 typehash, GachaMachine.BuybackAuth memory auth)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(typehash, auth.drawId, auth.payToken, auth.payout, auth.nonce, auth.deadline));
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }
}

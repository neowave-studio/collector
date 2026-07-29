// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

import {AccessController} from "../../src/access/AccessController.sol";
import {Roles} from "../../src/access/Roles.sol";
import {CollectibleNFT} from "../../src/CollectibleNFT.sol";
import {Vault} from "../../src/Vault.sol";
import {ReserveVault} from "../../src/ReserveVault.sol";
import {PaymentRouter} from "../../src/PaymentRouter.sol";
import {GachaMachine} from "../../src/GachaMachine.sol";
import {Marketplace} from "../../src/Marketplace.sol";
import {IPaymentRouter} from "../../src/interfaces/IPaymentRouter.sol";
import {PoolLib} from "../../src/libraries/PoolLib.sol";

import {MockERC20} from "../mocks/MockERC20.sol";
import {MockVRFCoordinator} from "../mocks/MockVRFCoordinator.sol";
import {MerkleHelper} from "./MerkleHelper.sol";

/// @notice Full-suite deployment used by every test: real UUPS proxies, a real 48h
///         `TimelockController` holding `DEFAULT_ADMIN_ROLE`, and the same role wiring the deployment
///         script performs.
///
/// @dev Bulk role grants in `setUp` are executed with `vm.prank(address(timelock))` rather than
///      through a full schedule/execute cycle — that is exactly what execution does, and keeps setup
///      readable. `TimelockGating.t.sol` exercises the genuine propose → wait 48h → execute path for
///      the value-extracting functions, which is where the guarantee actually matters.
abstract contract Fixture is Test {
    // --- actors -----------------------------------------------------------------------------
    address internal safe = makeAddr("safeMultisig");
    address internal ops = makeAddr("ops");
    address internal poolAuthor = makeAddr("poolAuthor");
    address internal relayer = makeAddr("relayer");
    address internal buybackRelayer = makeAddr("buybackRelayer");
    address internal inventoryAdmin = makeAddr("inventoryAdmin");
    address internal treasurer = makeAddr("treasurer");
    address internal tokenAdmin = makeAddr("tokenAdmin");
    address internal feeAdmin = makeAddr("feeAdmin");
    address internal pauser = makeAddr("pauser");
    address internal riskAdmin = makeAddr("riskAdmin");
    address internal minter = makeAddr("minter");
    address internal treasury = makeAddr("treasury");
    address internal royaltyReceiver = makeAddr("royaltyReceiver");

    address internal oracle;
    uint256 internal oraclePk;
    address internal alice;
    uint256 internal alicePk;
    address internal bob;
    uint256 internal bobPk;

    // --- contracts --------------------------------------------------------------------------
    TimelockController internal timelock;
    AccessController internal access;
    CollectibleNFT internal nft;
    Vault internal vault;
    ReserveVault internal reserve;
    PaymentRouter internal router;
    GachaMachine internal gacha;
    Marketplace internal market;
    MockERC20 internal usdc;
    MockVRFCoordinator internal vrf;

    // --- pack configuration -----------------------------------------------------------------
    bytes32 internal constant PACK = keccak256("PKMN50");
    uint256 internal constant VERSION = 1;
    uint256 internal constant PRICE_PER_RIP = 50e6; // 50 USDC
    uint16 internal constant BUYBACK_BPS = 8500;
    uint16 internal constant UNAVAILABLE_BPS = 10_000;
    uint16 internal constant HOUSE_MARGIN_BPS = 1000;
    uint16 internal constant RESERVE_BPS = 4000;
    bytes32 internal constant POOL_CID = keccak256("ipfs://pool-v1");

    uint64 internal constant BUYBACK_WINDOW = 1 hours;
    uint64 internal constant RIP_REVEAL_TIMEOUT = 1 hours;
    /// @dev With a 4-card pool this permits 2 releases before the version must be re-committed,
    ///      which is enough for multi-settle tests while still letting `PoolStale` be exercised.
    uint16 internal constant POOL_STALE_BPS = 5000;

    uint256 internal constant TIMELOCK_DELAY = 48 hours;
    uint256 internal constant EPOCH_OUTFLOW_CAP = 100_000e6;

    /// @dev Mirrors the frontend's advertised odds: 80 / 15 / 4 / 1.
    ///      Weighted mean priceRef = 45.40 USDC, so the committed house-margin invariant
    ///      (0.85 · 45.40 = 38.59 ≤ 50 · 0.90 = 45) holds with room to spare.
    uint256[4] internal WEIGHTS = [uint256(80), 15, 4, 1];
    uint256[4] internal PRICE_REFS = [uint256(30e6), 60e6, 110e6, 800e6];
    uint256 internal constant TOTAL_WEIGHT = 100;

    function setUp() public virtual {
        (oracle, oraclePk) = makeAddrAndKey("oracleSigner");
        (alice, alicePk) = makeAddrAndKey("alice");
        (bob, bobPk) = makeAddrAndKey("bob");

        usdc = new MockERC20("USD Coin", "USDC", 6);
        vrf = new MockVRFCoordinator();

        address[] memory safes = new address[](1);
        safes[0] = safe;
        timelock = new TimelockController(TIMELOCK_DELAY, safes, safes, address(0));

        _deployProxies();
        _wireRoles();
        _configure();
        _seedInventory();
        _commitDefaultPool();
    }

    // =============================================================================================
    // Deployment
    // =============================================================================================

    function _deployProxies() private {
        access = AccessController(
            address(
                new ERC1967Proxy(
                    address(new AccessController()),
                    abi.encodeCall(AccessController.initialize, (address(timelock), ops))
                )
            )
        );

        nft = CollectibleNFT(
            address(
                new ERC1967Proxy(
                    address(new CollectibleNFT()),
                    abi.encodeCall(
                        CollectibleNFT.initialize,
                        (address(access), "Collector Card", "CARD", "https://api.collector/meta/", royaltyReceiver, 500)
                    )
                )
            )
        );

        vault = Vault(
            address(
                new ERC1967Proxy(
                    address(new Vault()), abi.encodeCall(Vault.initialize, (address(access), address(nft)))
                )
            )
        );

        reserve = ReserveVault(
            address(
                new ERC1967Proxy(
                    address(new ReserveVault()),
                    abi.encodeCall(ReserveVault.initialize, (address(access), 1 days, 1000))
                )
            )
        );

        router = PaymentRouter(
            address(
                new ERC1967Proxy(
                    address(new PaymentRouter()),
                    // Permit2 is intentionally absent so tests exercise the allowance fallback that
                    // chains without Permit2 (e.g. Robinhood Chain) rely on.
                    abi.encodeCall(PaymentRouter.initialize, (address(access), address(0)))
                )
            )
        );

        GachaMachine.InitParams memory p = GachaMachine.InitParams({
            accessController: address(access),
            vault: address(vault),
            reserveVault: address(reserve),
            paymentRouter: address(router),
            treasury: treasury,
            vrfCoordinator: address(vrf),
            vrfSubscriptionId: 1,
            vrfKeyHash: keccak256("gaslane"),
            vrfCallbackGasLimit: 2_500_000,
            vrfRequestConfirmations: 3,
            vrfNativePayment: false,
            buybackWindow: BUYBACK_WINDOW,
            ripRevealTimeout: RIP_REVEAL_TIMEOUT,
            poolStaleThresholdBps: POOL_STALE_BPS
        });
        gacha = GachaMachine(
            address(new ERC1967Proxy(address(new GachaMachine()), abi.encodeCall(GachaMachine.initialize, (p))))
        );

        market = Marketplace(
            address(
                new ERC1967Proxy(
                    address(new Marketplace()),
                    abi.encodeCall(
                        Marketplace.initialize, (address(access), address(nft), address(router), treasury, 250)
                    )
                )
            )
        );
    }

    function _wireRoles() private {
        vm.startPrank(address(timelock));
        access.grantRole(Roles.POOL_AUTHOR_ROLE, poolAuthor);
        access.grantRole(Roles.INVENTORY_ADMIN_ROLE, inventoryAdmin);
        access.grantRole(Roles.TREASURER_ROLE, treasurer);
        access.grantRole(Roles.TOKEN_ADMIN_ROLE, tokenAdmin);
        access.grantRole(Roles.FEE_ADMIN_ROLE, feeAdmin);
        access.grantRole(Roles.PAUSE_ADMIN_ROLE, pauser);
        access.grantRole(Roles.METADATA_ADMIN_ROLE, ops);
        access.grantRole(Roles.MINTER_ROLE, minter);
        access.grantRole(Roles.RISK_ADMIN_ROLE, riskAdmin);
        // Spec §4 invariant: these two are granted to the GachaMachine and to nothing else.
        access.grantRole(Roles.SETTLEMENT_ROLE, address(gacha));
        access.grantRole(Roles.GACHA_ROLE, address(gacha));
        access.grantRole(Roles.PAYMENT_CONSUMER_ROLE, address(gacha));
        access.grantRole(Roles.PAYMENT_CONSUMER_ROLE, address(market));
        vm.stopPrank();

        // Hot operational keys are rotatable by OPERATIONS without a timelock (spec §6.2).
        vm.startPrank(ops);
        access.grantRole(Roles.TRUSTED_RELAYER_ROLE, relayer);
        access.grantRole(Roles.TRUSTED_ORACLE_ROLE, oracle);
        access.grantRole(Roles.TRUSTED_BUYBACK_ROLE, buybackRelayer);
        vm.stopPrank();

        vm.prank(address(timelock));
        vault.setGachaMachine(address(gacha));
    }

    function _configure() private {
        vm.prank(tokenAdmin);
        router.setAllowedPayToken(address(usdc), true);

        // Economic safety parameters sit behind DEFAULT_ADMIN (= the Timelock), not TREASURER.
        vm.prank(address(timelock));
        reserve.setMaxBuybackOutflow(address(usdc), EPOCH_OUTFLOW_CAP);

        // Fund the reserve well above the worst case so solvency checks are not the thing under test
        // unless a test deliberately makes them so.
        usdc.mint(treasurer, 5_000_000e6);
        vm.startPrank(treasurer);
        usdc.approve(address(reserve), type(uint256).max);
        reserve.fund(address(usdc), 5_000_000e6);
        vm.stopPrank();

        _fundUser(alice);
        _fundUser(bob);
    }

    function _fundUser(address user) internal {
        usdc.mint(user, 1_000_000e6);
        vm.prank(user);
        usdc.approve(address(router), type(uint256).max);
    }

    function _seedInventory() private {
        uint256[] memory ids = new uint256[](4);
        bytes32[] memory commitments = new bytes32[](4);
        for (uint256 i; i < 4; ++i) {
            ids[i] = i + 1;
            commitments[i] = keccak256(abi.encode("PSA-CERT", i + 1));
        }
        vm.prank(minter);
        nft.mintBatch(inventoryAdmin, ids, commitments);

        vm.startPrank(inventoryAdmin);
        nft.setApprovalForAll(address(vault), true);
        vault.depositBatch(ids, PACK);
        vm.stopPrank();
    }

    // =============================================================================================
    // Pool helpers
    // =============================================================================================

    function defaultLeaves() internal view returns (PoolLib.Leaf[] memory leaves) {
        leaves = new PoolLib.Leaf[](4);
        uint256 cum;
        for (uint256 i; i < 4; ++i) {
            leaves[i] =
                PoolLib.Leaf({tokenId: i + 1, cumBefore: cum, weight: WEIGHTS[i], priceRef: PRICE_REFS[i]});
            cum += WEIGHTS[i];
        }
    }

    function leafHashes(bytes32 packId, uint256 version, PoolLib.Leaf[] memory leaves)
        internal
        pure
        returns (bytes32[] memory hashes)
    {
        hashes = new bytes32[](leaves.length);
        for (uint256 i; i < leaves.length; ++i) {
            hashes[i] = PoolLib.leafHash(packId, version, i, leaves[i]);
        }
    }

    function defaultPoolParams() internal view returns (PoolLib.PoolParams memory) {
        return PoolLib.PoolParams({
            pricePerRip: PRICE_PER_RIP,
            payToken: address(usdc),
            buybackBps: BUYBACK_BPS,
            unavailableBps: UNAVAILABLE_BPS,
            houseMarginBps: HOUSE_MARGIN_BPS,
            reserveBps: RESERVE_BPS,
            poolCID: POOL_CID
        });
    }

    function _commitDefaultPool() private {
        vm.prank(poolAuthor);
        gacha.commitPool(PACK, VERSION, defaultPoolParams(), defaultLeaves());
        _activate(PACK, VERSION);
    }

    function _activate(bytes32 packId, uint256 version) internal {
        uint64 from = uint64(block.number + gacha.minActivationDelayBlocks());
        vm.prank(poolAuthor);
        gacha.setActivePoolVersion(packId, version, from);
        vm.roll(from);
    }

    /// @notice Builds the settlement opening for the leaf whose slice contains `winningWeight`.
    function proofForWeight(bytes32 packId, uint256 version, uint256 winningWeight)
        internal
        view
        returns (GachaMachine.LeafProof memory)
    {
        PoolLib.Leaf[] memory leaves = defaultLeaves();
        bytes32[] memory hashes = leafHashes(packId, version, leaves);
        for (uint256 i; i < leaves.length; ++i) {
            if (winningWeight >= leaves[i].cumBefore && winningWeight < leaves[i].cumBefore + leaves[i].weight) {
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
        revert("no slice contains weight");
    }

    function proofForIndex(bytes32 packId, uint256 version, uint256 index)
        internal
        view
        returns (GachaMachine.LeafProof memory)
    {
        PoolLib.Leaf[] memory leaves = defaultLeaves();
        bytes32[] memory hashes = leafHashes(packId, version, leaves);
        return GachaMachine.LeafProof({
            tokenId: leaves[index].tokenId,
            cumBefore: leaves[index].cumBefore,
            weight: leaves[index].weight,
            priceRef: leaves[index].priceRef,
            leafIndex: index,
            proof: MerkleHelper.buildProof(hashes, index)
        });
    }

    // =============================================================================================
    // Signing helpers
    // =============================================================================================

    function _digest(bytes32 domainSeparator, bytes32 structHash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function purchaseAuth(address user, uint96 numRips) internal view returns (GachaMachine.PurchaseAuth memory) {
        return GachaMachine.PurchaseAuth({
            user: user,
            packId: PACK,
            poolVersion: VERSION,
            numRips: numRips,
            payToken: address(usdc),
            amountPerRip: PRICE_PER_RIP,
            nonce: gacha.nonces(user),
            deadline: uint48(block.timestamp + 1 hours)
        });
    }

    function signPurchase(uint256 pk, GachaMachine.PurchaseAuth memory auth) internal view returns (bytes memory) {
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
        return _sign(pk, _digest(gacha.domainSeparator(), structHash));
    }

    function signBuyback(uint256 pk, bytes32 typehash, GachaMachine.BuybackAuth memory auth)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash =
            keccak256(abi.encode(typehash, auth.drawId, auth.payToken, auth.payout, auth.nonce, auth.deadline));
        return _sign(pk, _digest(gacha.domainSeparator(), structHash));
    }

    function emptyPermit() internal pure returns (IPaymentRouter.PaymentPermit memory) {
        return IPaymentRouter.PaymentPermit({nonce: 0, deadline: 0, signature: ""});
    }

    // =============================================================================================
    // Flow helpers
    // =============================================================================================

    /// @notice Buys `numRips` rips for `user` through the relayer, exactly as the backend would.
    function doRip(address user, uint256 pk, uint96 numRips) internal returns (uint256 firstDrawId) {
        GachaMachine.PurchaseAuth memory auth = purchaseAuth(user, numRips);
        bytes memory sig = signPurchase(pk, auth);
        vm.prank(relayer);
        firstDrawId = gacha.rip(auth, sig, emptyPermit());
    }

    /// @notice Delivers a VRF word so that the draw lands on `targetIndex`'s slice.
    function revealOn(uint256 requestId, uint256 leafIndex) internal returns (uint256 winningWeight) {
        PoolLib.Leaf[] memory leaves = defaultLeaves();
        winningWeight = leaves[leafIndex].cumBefore;
        // TOTAL_WEIGHT divides 2^256 only when it is a power of two, so pick a word that is inside the
        // acceptance window and reduces exactly to the target: the raw value itself does both.
        vrf.fulfillOne(requestId, winningWeight);
    }

    function ripAndReveal(address user, uint256 pk, uint256 leafIndex)
        internal
        returns (uint256 drawId, GachaMachine.LeafProof memory proof)
    {
        drawId = doRip(user, pk, 1);
        uint256 requestId = vrf.nextRequestId() - 1;
        uint256 w = revealOn(requestId, leafIndex);
        proof = proofForWeight(PACK, VERSION, w);
    }
}

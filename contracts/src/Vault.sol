// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {RoleGatedUpgradeable} from "./access/RoleGatedUpgradeable.sol";
import {Roles} from "./access/Roles.sol";
import {IVault} from "./interfaces/IVault.sol";

/// @notice Minimal view the Vault needs from the GachaMachine to block unsafe sweeps.
interface IGachaPendingDraws {
    function pendingDraws(bytes32 packId) external view returns (uint256);
}

/// @title Vault (Inventory)
/// @notice Custodies CollectibleNFTs that are not yet owned by a user (spec §5.2).
///
/// Exit paths — there are exactly two, and both are honest about their trust level (spec §7.1.3):
///  1. `releaseTo` — callable ONLY by SETTLEMENT_ROLE, which is granted ONLY to the GachaMachine, which
///     only calls it after verifying a Merkle proof against the draw's committed pool version.
///  2. `sweepTo` — mis-mint / wrong-card recovery. INVENTORY_ADMIN_ROLE exercised through the 48h
///     Timelock, blocked entirely while the pack has any unresolved draw, and always event-logged.
///
/// Per-pack partitioning (spec FIX H5-sec): every deposited token is earmarked to exactly one pack.
/// `releaseTo` re-checks that earmark, and `commitPool` refuses to commit a pool containing a token the
/// Vault does not hold for that pack — which also makes 1:1 physical backing of every committed pool a
/// contract-enforced property rather than an operational promise.
contract Vault is RoleGatedUpgradeable, IERC721Receiver, IVault {
    /// @notice The collection this vault custodies.
    IERC721 public collectible;

    /// @notice Set for a token while this contract custodies it.
    mapping(uint256 tokenId => bool) public isHeld;

    /// @notice Pack a held token is earmarked for. `bytes32(0)` = received but not yet assigned.
    mapping(uint256 tokenId => bytes32) public tokenPack;

    /// @notice The GachaMachine, consulted by `sweepTo` to refuse sweeping a pack with live draws.
    IGachaPendingDraws public gachaMachine;

    error NotHeld(uint256 tokenId);
    error AlreadyHeld(uint256 tokenId);
    error WrongPack(uint256 tokenId, bytes32 expected, bytes32 actual);
    error AlreadyAssigned(uint256 tokenId, bytes32 packId);
    error PackHasPendingDraws(bytes32 packId, uint256 pending);
    error UnexpectedCollection(address caller);
    error ZeroPackId();

    event Deposited(uint256 indexed tokenId, bytes32 indexed packId, address indexed from);
    event PackAssigned(uint256 indexed tokenId, bytes32 indexed packId);
    event Released(uint256 indexed tokenId, bytes32 indexed packId, address indexed to);
    event Swept(uint256 indexed tokenId, bytes32 indexed packId, address indexed to, address by);
    event GachaMachineUpdated(address indexed gachaMachine);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address accessController_, address collectible_) external initializer {
        if (collectible_ == address(0)) revert ZeroAddress();
        __RoleGated_init(accessController_);
        collectible = IERC721(collectible_);
    }

    /// @dev Wiring step, Timelock-gated: the GachaMachine proxy does not exist yet at Vault init time.
    function setGachaMachine(address gachaMachine_) external onlyRole(Roles.DEFAULT_ADMIN_ROLE) {
        if (gachaMachine_ == address(0)) revert ZeroAddress();
        gachaMachine = IGachaPendingDraws(gachaMachine_);
        emit GachaMachineUpdated(gachaMachine_);
    }

    // ---------------------------------------------------------------------------------------------
    // Intake
    // ---------------------------------------------------------------------------------------------

    /// @notice Pulls tokens from the caller into inventory, earmarked to `packId`.
    function depositBatch(uint256[] calldata tokenIds, bytes32 packId)
        external
        nonReentrant
        onlyRole(Roles.INVENTORY_ADMIN_ROLE)
    {
        if (packId == bytes32(0)) revert ZeroPackId();
        for (uint256 i; i < tokenIds.length; ++i) {
            uint256 tokenId = tokenIds[i];
            if (isHeld[tokenId]) revert AlreadyHeld(tokenId);
            isHeld[tokenId] = true;
            tokenPack[tokenId] = packId;
            emit Deposited(tokenId, packId, msg.sender);
            // Interaction last (CEI). `onERC721Received` sees `isHeld` already true and no-ops.
            collectible.transferFrom(msg.sender, address(this), tokenId);
        }
    }

    /// @notice Earmarks a token that arrived unassigned (e.g. minted straight to the vault).
    /// @dev One-way only: `bytes32(0)` → `packId`. Moving a token between packs requires the
    ///      Timelocked `sweepTo` + re-deposit, so a pack's committed inventory cannot be quietly
    ///      re-pointed underneath a live pool.
    function assignPack(uint256[] calldata tokenIds, bytes32 packId) external onlyRole(Roles.INVENTORY_ADMIN_ROLE) {
        if (packId == bytes32(0)) revert ZeroPackId();
        for (uint256 i; i < tokenIds.length; ++i) {
            uint256 tokenId = tokenIds[i];
            if (!isHeld[tokenId]) revert NotHeld(tokenId);
            bytes32 current = tokenPack[tokenId];
            if (current != bytes32(0)) revert AlreadyAssigned(tokenId, current);
            tokenPack[tokenId] = packId;
            emit PackAssigned(tokenId, packId);
        }
    }

    /// @inheritdoc IVault
    function requirePoolMembership(bytes32 packId, uint256[] calldata tokenIds) external view {
        for (uint256 i; i < tokenIds.length; ++i) {
            uint256 tokenId = tokenIds[i];
            if (!isHeld[tokenId]) revert NotHeld(tokenId);
            bytes32 assigned = tokenPack[tokenId];
            if (assigned != packId) revert WrongPack(tokenId, packId, assigned);
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Exits
    // ---------------------------------------------------------------------------------------------

    /// @inheritdoc IVault
    /// @dev Deliberately NOT `whenNotPaused`: the GachaMachine's unpausable `claimAfterTimeout` path
    ///      routes through here, and pausing must never strand a paid user (spec §7.1.11).
    function releaseTo(address to, uint256 tokenId, bytes32 packId)
        external
        nonReentrant
        onlyRole(Roles.SETTLEMENT_ROLE)
    {
        if (!isHeld[tokenId]) revert NotHeld(tokenId);
        bytes32 assigned = tokenPack[tokenId];
        if (assigned != packId) revert WrongPack(tokenId, packId, assigned);

        isHeld[tokenId] = false;
        tokenPack[tokenId] = bytes32(0);
        emit Released(tokenId, packId, to);
        collectible.safeTransferFrom(address(this), to, tokenId);
    }

    /// @notice Mis-mint recovery. INVENTORY_ADMIN_ROLE is exercised through the 48h Timelock.
    /// @dev Blocked while the token's pack has ANY unresolved draw (spec FIX M4-sec).
    ///
    ///      Deviation from spec §5.2, deliberate: the spec asks to block only "the target of a
    ///      revealed-but-unsettled draw", but on-chain nothing knows a revealed draw's target — the
    ///      winning tokenId is only recoverable by walking the pool off-chain and presenting a Merkle
    ///      proof. We therefore block on the strictly stronger, actually-computable condition: no
    ///      unresolved draw may exist for the pack at all. Ops drain a pack by pausing rips and
    ///      waiting out `RIP_REVEAL_TIMEOUT` / `BUYBACK_WINDOW`.
    function sweepTo(address to, uint256 tokenId) external nonReentrant onlyRole(Roles.INVENTORY_ADMIN_ROLE) {
        if (!isHeld[tokenId]) revert NotHeld(tokenId);
        bytes32 packId = tokenPack[tokenId];

        if (packId != bytes32(0) && address(gachaMachine) != address(0)) {
            uint256 pending = gachaMachine.pendingDraws(packId);
            if (pending != 0) revert PackHasPendingDraws(packId, pending);
        }

        isHeld[tokenId] = false;
        tokenPack[tokenId] = bytes32(0);
        emit Swept(tokenId, packId, to, msg.sender);
        collectible.safeTransferFrom(address(this), to, tokenId);
    }

    // ---------------------------------------------------------------------------------------------
    // ERC721 receiver
    // ---------------------------------------------------------------------------------------------

    /// @notice Accepts tokens pushed directly to the vault (e.g. minted to it) and books them as
    ///         held-but-unassigned so they cannot silently become part of any pool.
    function onERC721Received(address, address from, uint256 tokenId, bytes calldata)
        external
        override
        returns (bytes4)
    {
        if (msg.sender != address(collectible)) revert UnexpectedCollection(msg.sender);
        if (!isHeld[tokenId]) {
            isHeld[tokenId] = true;
            emit Deposited(tokenId, bytes32(0), from);
        }
        return IERC721Receiver.onERC721Received.selector;
    }

    uint256[50] private __gap;
}

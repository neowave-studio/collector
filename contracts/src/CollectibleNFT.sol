// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {ERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import {ERC2981Upgradeable} from "@openzeppelin/contracts-upgradeable/token/common/ERC2981Upgradeable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {RoleGatedUpgradeable} from "./access/RoleGatedUpgradeable.sol";
import {Roles} from "./access/Roles.sol";

/// @title CollectibleNFT
/// @notice ERC-721 (+EIP-2981) where one token == one specific graded physical card held in the vault
///         (spec §5.1).
///
/// Invariants an auditor must be able to point at (spec §5.1 / §7.1.10):
///  - one tokenId ↔ one grading certificate, forever: `cardCommitment` is write-once and
///    `commitmentOwner` makes the reverse direction unique too;
///  - a redeemed (burned) token can never be re-minted, re-released or transferred: `redeemed` is set
///    BEFORE the burn (CEI) and is checked by `mint`;
///  - no per-token royalty setter is exposed, so EIP-2981 output cannot be manipulated per sale.
contract CollectibleNFT is ERC721Upgradeable, ERC2981Upgradeable, RoleGatedUpgradeable {
    using Strings for uint256;

    /// @notice keccak256 of {certNumber, grade, gradingCo, scanHash} — the off-chain identity of the
    ///         physical card, bound at mint and immutable thereafter.
    mapping(uint256 tokenId => bytes32) public cardCommitment;

    /// @notice Reverse index: a grading certificate can back at most one token, ever.
    mapping(bytes32 commitment => uint256 tokenId) public commitmentOwner;

    /// @notice Set when the holder burns the token to claim the physical card.
    mapping(uint256 tokenId => bool) public redeemed;

    /// @notice Fiat-chargeback holdback (spec §9 FIX C4-backend): the token cannot be transferred or
    ///         redeemed until this timestamp. Duration-capped and event-logged; it can never move,
    ///         seize or burn the token — only delay its exit while a card payment is still reversible.
    mapping(uint256 tokenId => uint64) public transferLockedUntil;

    string private _baseTokenURI;

    /// @dev Long enough to cover card-network chargeback windows (60–120+ days per §9), with a hard
    ///      ceiling so the power can never become an indefinite freeze.
    uint64 public constant MAX_TRANSFER_LOCK = 150 days;

    error TokenAlreadyExists(uint256 tokenId);
    error CommitmentAlreadyUsed(bytes32 commitment);
    error EmptyCommitment();
    error TokenRedeemed(uint256 tokenId);
    error NotTokenOwner(uint256 tokenId, address caller);
    error TransferLocked(uint256 tokenId, uint64 until);
    error LockTooLong(uint64 requested, uint64 max);
    error LengthMismatch();

    event Minted(uint256 indexed tokenId, address indexed to, bytes32 commitment);
    event RedeemRequested(address indexed owner, uint256 indexed tokenId, bytes32 commitment);
    event BaseURIUpdated(string baseURI);
    event TransferLockSet(uint256 indexed tokenId, uint64 until, address indexed by);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address accessController_,
        string calldata name_,
        string calldata symbol_,
        string calldata baseURI_,
        address royaltyReceiver,
        uint96 royaltyBps
    ) external initializer {
        __ERC721_init(name_, symbol_);
        __ERC2981_init();
        __RoleGated_init(accessController_);
        _baseTokenURI = baseURI_;
        if (royaltyReceiver != address(0)) _setDefaultRoyalty(royaltyReceiver, royaltyBps);
    }

    // ---------------------------------------------------------------------------------------------
    // Minting (intake)
    // ---------------------------------------------------------------------------------------------

    /// @notice Mints the token that represents a newly vaulted, graded physical card.
    /// @param commitment keccak256({certNumber, grade, gradingCo, scanHash}). Must be unique and non-zero.
    function mint(address to, uint256 tokenId, bytes32 commitment) public onlyRole(Roles.MINTER_ROLE) {
        if (commitment == bytes32(0)) revert EmptyCommitment();
        // `redeemed` blocks resurrection: after a burn `_ownerOf` is zero again, so `_mint` alone
        // would happily re-create the token.
        if (redeemed[tokenId]) revert TokenRedeemed(tokenId);
        if (cardCommitment[tokenId] != bytes32(0)) revert TokenAlreadyExists(tokenId);
        if (commitmentOwner[commitment] != 0) revert CommitmentAlreadyUsed(commitment);

        cardCommitment[tokenId] = commitment;
        commitmentOwner[commitment] = tokenId;
        _mint(to, tokenId);
        emit Minted(tokenId, to, commitment);
    }

    function mintBatch(address to, uint256[] calldata tokenIds, bytes32[] calldata commitments)
        external
        onlyRole(Roles.MINTER_ROLE)
    {
        if (tokenIds.length != commitments.length) revert LengthMismatch();
        for (uint256 i; i < tokenIds.length; ++i) {
            mint(to, tokenIds[i], commitments[i]);
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Redemption (burn-to-claim-physical)
    // ---------------------------------------------------------------------------------------------

    /// @notice Burns the token to claim the physical card. Off-chain shipment is driven ONLY by the
    ///         `RedeemRequested` event and is idempotent on tokenId (spec §5.1 FIX H7-backend).
    /// @dev Effects (mark redeemed) strictly before the interaction (burn), so a re-entrant call
    ///      during `_update` cannot redeem twice.
    function redeem(uint256 tokenId) external nonReentrant {
        address owner_ = _requireOwned(tokenId);
        if (owner_ != msg.sender) revert NotTokenOwner(tokenId, msg.sender);
        if (redeemed[tokenId]) revert TokenRedeemed(tokenId);
        uint64 until = transferLockedUntil[tokenId];
        if (block.timestamp < until) revert TransferLocked(tokenId, until);

        redeemed[tokenId] = true;
        bytes32 commitment = cardCommitment[tokenId];
        _burn(tokenId);
        emit RedeemRequested(owner_, tokenId, commitment);
    }

    // ---------------------------------------------------------------------------------------------
    // Risk holdback
    // ---------------------------------------------------------------------------------------------

    /// @notice Time-boxes a fiat-funded token's exit while the card payment can still be reversed.
    /// @dev Monotonic-by-policy is NOT enforced downward: a risk admin may shorten a lock once a
    ///      payment clears. It can never exceed `MAX_TRANSFER_LOCK` from now, and every change emits.
    function setTransferLock(uint256 tokenId, uint64 until) external onlyRole(Roles.RISK_ADMIN_ROLE) {
        uint64 max = uint64(block.timestamp) + MAX_TRANSFER_LOCK;
        if (until > max) revert LockTooLong(until, max);
        transferLockedUntil[tokenId] = until;
        emit TransferLockSet(tokenId, until, msg.sender);
    }

    // ---------------------------------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------------------------------

    function setBaseURI(string calldata baseURI_) external onlyRole(Roles.METADATA_ADMIN_ROLE) {
        _baseTokenURI = baseURI_;
        emit BaseURIUpdated(baseURI_);
    }

    /// @dev FEE_ADMIN_ROLE is granted to ops, but changing the default royalty is an economic change,
    ///      so the deployment scripts grant it through the Timelock (spec §5.1).
    function setDefaultRoyalty(address receiver, uint96 feeNumerator) external onlyRole(Roles.FEE_ADMIN_ROLE) {
        _setDefaultRoyalty(receiver, feeNumerator);
    }

    // ---------------------------------------------------------------------------------------------
    // Internals / views
    // ---------------------------------------------------------------------------------------------

    /// @dev Single choke point for every mint, transfer and burn. Enforces the holdback on transfers
    ///      while leaving mint (`from == 0`) and the owner's own `redeem` burn path free — `redeem`
    ///      checks the lock itself so the error is precise.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = super._update(to, tokenId, auth);
        if (from != address(0) && to != address(0)) {
            uint64 until = transferLockedUntil[tokenId];
            if (block.timestamp < until) revert TransferLocked(tokenId, until);
        }
        return from;
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return string.concat(_baseTokenURI, tokenId.toString());
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721Upgradeable, ERC2981Upgradeable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    uint256[50] private __gap;
}

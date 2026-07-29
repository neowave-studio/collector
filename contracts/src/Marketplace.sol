// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {RoleGatedUpgradeable} from "./access/RoleGatedUpgradeable.sol";
import {Roles} from "./access/Roles.sol";
import {IPaymentRouter} from "./interfaces/IPaymentRouter.sol";

/// @title Marketplace
/// @notice Fixed-price listings and offers, signed off-chain and filled on-chain (spec §5.6).
///
/// Replay and rounding controls (spec FIX M2-sec):
///  - listings and offers share field layout but use DIFFERENT typehashes, so a seller's listing
///    signature can never be replayed as a bid and vice versa;
///  - every order carries a per-maker nonce plus an expiry, both inside the signed hash;
///  - the EIP-712 domain carries `chainId` + `verifyingContract`, which is the only thing separating
///    our identical CREATE2 addresses across chains (spec §3);
///  - `fee + royalty <= price` is enforced, both rounded down, with the remainder to the seller.
contract Marketplace is RoleGatedUpgradeable, EIP712Upgradeable {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;

    /// @notice Hard ceiling on the platform fee, enforced in code and not raisable by any role.
    uint16 public constant MAX_FEE_BPS = 1000;

    struct Order {
        address maker;
        uint256 tokenId;
        uint256 price;
        address payToken;
        uint256 nonce;
        uint48 expiry;
    }

    bytes32 public constant LISTING_TYPEHASH = keccak256(
        "Listing(address maker,uint256 tokenId,uint256 price,address payToken,uint256 nonce,uint48 expiry)"
    );
    bytes32 public constant OFFER_TYPEHASH =
        keccak256("Offer(address maker,uint256 tokenId,uint256 price,address payToken,uint256 nonce,uint48 expiry)");

    IERC721 public collectible;
    IPaymentRouter public paymentRouter;
    address public feeRecipient;
    uint16 public feeBps;

    /// @notice Consumed order nonces per maker.
    mapping(address maker => mapping(uint256 nonce => bool)) public orderNonceUsed;

    /// @notice Bulk cancel: every order with `nonce < minOrderNonce[maker]` is dead.
    mapping(address maker => uint256) public minOrderNonce;

    error OrderExpired(uint48 expiry);
    error NonceAlreadyUsed(address maker, uint256 nonce);
    error NonceBelowMinimum(uint256 nonce, uint256 minimum);
    error InvalidSignature();
    error FeeTooHigh(uint16 bps);
    error NotTokenOwner(uint256 tokenId, address caller);
    error MakerIsNotOwner(uint256 tokenId, address maker);
    error SelfTrade();
    error ZeroPrice();
    error PayoutExceedsPrice(uint256 fee, uint256 royalty, uint256 price);

    event Filled(
        bytes32 indexed orderHash,
        address indexed seller,
        address indexed buyer,
        uint256 tokenId,
        uint256 price,
        uint256 fee,
        uint256 royalty
    );
    event OrderCancelled(bytes32 indexed orderHash, address indexed maker, uint256 nonce);
    event MinNonceBumped(address indexed maker, uint256 minimum);
    event FeeUpdated(uint16 bps, address indexed by);
    event FeeRecipientUpdated(address indexed recipient);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address accessController_,
        address collectible_,
        address paymentRouter_,
        address feeRecipient_,
        uint16 feeBps_
    ) external initializer {
        if (collectible_ == address(0) || paymentRouter_ == address(0) || feeRecipient_ == address(0)) {
            revert ZeroAddress();
        }
        __RoleGated_init(accessController_);
        __EIP712_init("CollectorMarketplace", "1");
        collectible = IERC721(collectible_);
        paymentRouter = IPaymentRouter(paymentRouter_);
        feeRecipient = feeRecipient_;
        _setFeeBps(feeBps_);
    }

    // ---------------------------------------------------------------------------------------------
    // Fills
    // ---------------------------------------------------------------------------------------------

    /// @notice Buyer fills a seller's signed listing.
    function buy(Order calldata order, bytes calldata makerSig, IPaymentRouter.PaymentPermit calldata payment)
        external
        nonReentrant
        whenNotPaused
    {
        bytes32 orderHash = _validate(order, makerSig, LISTING_TYPEHASH);
        if (msg.sender == order.maker) revert SelfTrade();
        if (collectible.ownerOf(order.tokenId) != order.maker) revert MakerIsNotOwner(order.tokenId, order.maker);
        _fill(orderHash, order, order.maker, msg.sender, payment);
    }

    /// @notice Token owner accepts a buyer's signed offer.
    function acceptOffer(
        Order calldata order,
        bytes calldata makerSig,
        IPaymentRouter.PaymentPermit calldata payment
    ) external nonReentrant whenNotPaused {
        bytes32 orderHash = _validate(order, makerSig, OFFER_TYPEHASH);
        if (msg.sender == order.maker) revert SelfTrade();
        if (collectible.ownerOf(order.tokenId) != msg.sender) revert NotTokenOwner(order.tokenId, msg.sender);
        _fill(orderHash, order, msg.sender, order.maker, payment);
    }

    function _validate(Order calldata order, bytes calldata sig, bytes32 typehash) private returns (bytes32) {
        if (order.price == 0) revert ZeroPrice();
        if (block.timestamp > order.expiry) revert OrderExpired(order.expiry);
        if (order.nonce < minOrderNonce[order.maker]) {
            revert NonceBelowMinimum(order.nonce, minOrderNonce[order.maker]);
        }
        if (orderNonceUsed[order.maker][order.nonce]) revert NonceAlreadyUsed(order.maker, order.nonce);
        orderNonceUsed[order.maker][order.nonce] = true;

        bytes32 orderHash = _hashOrder(typehash, order);
        if (!SignatureChecker.isValidSignatureNow(order.maker, orderHash, sig)) revert InvalidSignature();
        return orderHash;
    }

    function _fill(
        bytes32 orderHash,
        Order calldata order,
        address seller,
        address buyer,
        IPaymentRouter.PaymentPermit calldata payment
    ) private {
        uint256 price = order.price;
        uint256 fee = price * feeBps / BPS;
        uint256 royalty = _royalty(order.tokenId, price, seller);

        // Belt-and-braces: `feeBps <= MAX_FEE_BPS` and the royalty clamp already guarantee this, but a
        // future royalty implementation returning nonsense must not be able to underflow the seller.
        if (fee + royalty > price) revert PayoutExceedsPrice(fee, royalty, price);
        uint256 sellerProceeds = price - fee - royalty;

        // Funds land here first so the split is atomic and a failing leg reverts the whole fill.
        paymentRouter.collectForOrder(buyer, order.payToken, price, address(this), orderHash, payment);

        emit Filled(orderHash, seller, buyer, order.tokenId, price, fee, royalty);

        collectible.safeTransferFrom(seller, buyer, order.tokenId);

        IERC20 token = IERC20(order.payToken);
        if (fee != 0) token.safeTransfer(feeRecipient, fee);
        if (royalty != 0) token.safeTransfer(_royaltyReceiver(order.tokenId, price), royalty);
        if (sellerProceeds != 0) token.safeTransfer(seller, sellerProceeds);
    }

    /// @dev EIP-2981 output is untrusted input: a malformed or hostile implementation must not be
    ///      able to zero out the seller. Clamp to whatever is left after the platform fee.
    function _royalty(uint256 tokenId, uint256 price, address seller) private view returns (uint256) {
        try IERC2981(address(collectible)).royaltyInfo(tokenId, price) returns (address receiver, uint256 amount) {
            if (receiver == address(0) || receiver == seller) return 0;
            uint256 max = price - (price * feeBps / BPS);
            return amount > max ? max : amount;
        } catch {
            return 0;
        }
    }

    function _royaltyReceiver(uint256 tokenId, uint256 price) private view returns (address) {
        (address receiver,) = IERC2981(address(collectible)).royaltyInfo(tokenId, price);
        return receiver;
    }

    // ---------------------------------------------------------------------------------------------
    // Cancellation
    // ---------------------------------------------------------------------------------------------

    function cancel(Order calldata order, bool isListing) external {
        if (msg.sender != order.maker) revert InvalidSignature();
        orderNonceUsed[order.maker][order.nonce] = true;
        emit OrderCancelled(_hashOrder(isListing ? LISTING_TYPEHASH : OFFER_TYPEHASH, order), order.maker, order.nonce);
    }

    /// @notice Invalidates every outstanding order of the caller below `minimum` in one transaction.
    function bumpMinNonce(uint256 minimum) external {
        if (minimum <= minOrderNonce[msg.sender]) revert NonceBelowMinimum(minimum, minOrderNonce[msg.sender]);
        minOrderNonce[msg.sender] = minimum;
        emit MinNonceBumped(msg.sender, minimum);
    }

    // ---------------------------------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------------------------------

    /// @dev Instant by design (spec §6.2) but capped in code and alerted on off-chain (§8.7).
    function setFeeBps(uint16 bps) external onlyRole(Roles.FEE_ADMIN_ROLE) {
        _setFeeBps(bps);
    }

    /// @dev Redirecting fee revenue is value extraction, so it is Timelocked (spec FIX M5-sec).
    function setFeeRecipient(address recipient) external onlyRole(Roles.DEFAULT_ADMIN_ROLE) {
        if (recipient == address(0)) revert ZeroAddress();
        feeRecipient = recipient;
        emit FeeRecipientUpdated(recipient);
    }

    function _setFeeBps(uint16 bps) private {
        if (bps > MAX_FEE_BPS) revert FeeTooHigh(bps);
        feeBps = bps;
        emit FeeUpdated(bps, msg.sender);
    }

    // ---------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------

    function hashListing(Order calldata order) external view returns (bytes32) {
        return _hashOrder(LISTING_TYPEHASH, order);
    }

    function hashOffer(Order calldata order) external view returns (bytes32) {
        return _hashOrder(OFFER_TYPEHASH, order);
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _hashOrder(bytes32 typehash, Order calldata order) private view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    typehash, order.maker, order.tokenId, order.price, order.payToken, order.nonce, order.expiry
                )
            )
        );
    }

    uint256[50] private __gap;
}

import {parseAbi} from 'viem';

/**
 * Human-readable ABI fragments for everything the backend touches.
 *
 * Deliberately hand-written rather than generated from `contracts/out`: it keeps the backend free of a
 * build-order dependency on Foundry, and it makes the exact surface the backend is allowed to use
 * explicit and reviewable. `test/abi.test.ts` cross-checks these selectors against the compiled
 * artifacts so a signature drift fails CI rather than at runtime.
 */

export const gachaAbi = parseAbi([
  // --- writes ---------------------------------------------------------------------------------
  'struct PurchaseAuth { address user; bytes32 packId; uint256 poolVersion; uint96 numRips; address payToken; uint256 amountPerRip; uint256 nonce; uint48 deadline; }',
  'struct BuybackAuth { uint256 drawId; address payToken; uint256 payout; uint256 nonce; uint48 deadline; }',
  'struct PaymentPermit { uint256 nonce; uint256 deadline; bytes signature; }',
  'struct LeafProof { uint256 tokenId; uint256 cumBefore; uint256 weight; uint256 priceRef; uint256 leafIndex; bytes32[] proof; }',
  'struct Leaf { uint256 tokenId; uint256 cumBefore; uint256 weight; uint256 priceRef; }',
  'struct PoolParams { uint256 pricePerRip; address payToken; uint16 buybackBps; uint16 unavailableBps; uint16 houseMarginBps; uint16 reserveBps; bytes32 poolCID; }',
  'struct PoolVersion { bytes32 root; bytes32 poolCID; uint256 totalWeight; uint256 pricePerRip; uint256 maxReservePerRip; uint256 maxBuybackPerRip; address payToken; uint16 buybackBps; uint16 unavailableBps; uint16 houseMarginBps; uint16 reserveBps; uint32 cardCount; uint32 releasedCount; bool finalized; }',
  'struct Draw { address user; bool revealed; bool settled; uint40 createdAt; uint40 revealedAt; bytes32 packId; uint128 poolVersion; uint128 winningWeight; uint128 reservedAmount; uint128 escrow; }',

  'function rip(PurchaseAuth auth, bytes userSig, PaymentPermit payment) returns (uint256)',
  'function settle(uint256 drawId, LeafProof leafProof)',
  'function claimAfterTimeout(uint256 drawId, LeafProof leafProof)',
  'function claimUnavailable(uint256 drawId, LeafProof leafProof)',
  'function refundStuckRip(uint256 drawId)',
  'function settleBuyback(uint256 drawId, BuybackAuth auth, bytes userSig, bytes oracleSig, LeafProof leafProof)',
  'function flushRevenue(address token)',
  'function commitPoolStart(bytes32 packId, uint256 version, PoolParams params)',
  'function commitPoolChunk(bytes32 packId, uint256 version, Leaf[] leaves)',
  'function finalizePool(bytes32 packId, uint256 version)',
  'function commitPool(bytes32 packId, uint256 version, PoolParams params, Leaf[] leaves)',
  'function setActivePoolVersion(bytes32 packId, uint256 version, uint64 activeFromBlock)',
  'function setBuybackLock(address user, uint64 until)',
  'function pause()',
  'function unpause()',

  // --- reads ----------------------------------------------------------------------------------
  'function activePoolVersion(bytes32 packId) view returns (uint256)',
  'function getPoolVersion(bytes32 packId, uint256 version) view returns (PoolVersion)',
  'function getDraw(uint256 drawId) view returns (Draw)',
  'function nonces(address user) view returns (uint256)',
  'function pendingDraws(bytes32 packId) view returns (uint256)',
  'function poolLeafCount(bytes32 packId, uint256 version) view returns (uint256)',
  'function poolLeafHash(bytes32 packId, uint256 version, uint256 index) view returns (bytes32)',
  'function buybackWindow() view returns (uint64)',
  'function ripRevealTimeout() view returns (uint64)',
  'function escrowedFunds(address token) view returns (uint256)',
  'function domainSeparator() view returns (bytes32)',
  'function paused() view returns (bool)',
  'function minActivationDelayBlocks() view returns (uint256)',

  // --- events ---------------------------------------------------------------------------------
  'event PoolCommitted(bytes32 indexed packId, uint256 indexed version, bytes32 root, uint256 totalWeight, uint256 pricePerRip, address payToken, uint16 buybackBps, bytes32 poolCID)',
  'event ActiveVersionScheduled(bytes32 indexed packId, uint256 indexed version, uint64 activeFromBlock)',
  'event RipRequested(address indexed user, bytes32 indexed packId, uint256 indexed poolVersion, uint256 firstDrawId, uint96 numRips, uint256 vrfRequestId)',
  'event RipRevealed(uint256 indexed drawId, uint256 winningWeight)',
  'event RevealFailed(uint256 indexed drawId, uint256 vrfRequestId)',
  'event RipSettled(uint256 indexed drawId, address indexed user, uint256 indexed tokenId, bool viaTimeout)',
  'event BuybackSettled(uint256 indexed drawId, address indexed user, uint256 payout, uint256 tokenId)',
  'event DrawUnavailable(uint256 indexed drawId, address indexed user, uint256 indexed tokenId, uint256 payout)',
  'event RipRefunded(uint256 indexed drawId, address indexed user, uint256 amount)',
  'event RevenueFlushed(address indexed token, uint256 toReserve, uint256 toTreasury)',
]);

export const reserveVaultAbi = parseAbi([
  'function reservedLiabilities(address token) view returns (uint256)',
  'function totalDeposited(address token) view returns (uint256)',
  'function totalPaid(address token) view returns (uint256)',
  'function proofOfReserves(address token) view returns (uint256 balance, uint256 reserved, int256 surplus)',
  'function outflowRemaining(address token) view returns (uint256)',
  'function maxBuybackOutflowPerEpoch(address token) view returns (uint256)',
  'function surplusBufferBps() view returns (uint16)',
  'function fund(address token, uint256 amount)',
  'function paused() view returns (bool)',
  'function pause()',
  'event Funded(address indexed token, address indexed from, uint256 amount, uint256 newBalance)',
  'event Reserved(address indexed token, uint256 amount, uint256 totalReserved)',
  'event Unreserved(address indexed token, uint256 amount, uint256 totalReserved)',
  'event Paid(address indexed token, address indexed to, uint256 amount, uint256 releasedRemainder)',
  'event SurplusWithdrawn(address indexed token, address indexed to, uint256 amount, address by)',
]);

export const vaultAbi = parseAbi([
  'function isHeld(uint256 tokenId) view returns (bool)',
  'function tokenPack(uint256 tokenId) view returns (bytes32)',
  'function depositBatch(uint256[] tokenIds, bytes32 packId)',
  'event Deposited(uint256 indexed tokenId, bytes32 indexed packId, address indexed from)',
  'event Released(uint256 indexed tokenId, bytes32 indexed packId, address indexed to)',
  'event Swept(uint256 indexed tokenId, bytes32 indexed packId, address indexed to, address by)',
]);

export const collectibleAbi = parseAbi([
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function cardCommitment(uint256 tokenId) view returns (bytes32)',
  'function redeemed(uint256 tokenId) view returns (bool)',
  'function transferLockedUntil(uint256 tokenId) view returns (uint64)',
  'function mintBatch(address to, uint256[] tokenIds, bytes32[] commitments)',
  'function setTransferLock(uint256 tokenId, uint64 until)',
  'event Minted(uint256 indexed tokenId, address indexed to, bytes32 commitment)',
  'event RedeemRequested(address indexed owner, uint256 indexed tokenId, bytes32 commitment)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
]);

export const marketplaceAbi = parseAbi([
  'struct Order { address maker; uint256 tokenId; uint256 price; address payToken; uint256 nonce; uint48 expiry; }',
  'struct PaymentPermit { uint256 nonce; uint256 deadline; bytes signature; }',
  'function buy(Order order, bytes makerSig, PaymentPermit payment)',
  'function acceptOffer(Order order, bytes makerSig, PaymentPermit payment)',
  'function hashListing(Order order) view returns (bytes32)',
  'function hashOffer(Order order) view returns (bytes32)',
  'function orderNonceUsed(address maker, uint256 nonce) view returns (bool)',
  'function minOrderNonce(address maker) view returns (uint256)',
  'function feeBps() view returns (uint16)',
  'event Filled(bytes32 indexed orderHash, address indexed seller, address indexed buyer, uint256 tokenId, uint256 price, uint256 fee, uint256 royalty)',
]);

export const erc20Abi = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);

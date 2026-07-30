// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title FaucetStablecoin
/// @notice Six-decimal test stablecoin with a self-service faucet. TESTNET ONLY.
///
/// Exists so a tester can obtain the pay token without waiting on a third-party faucet's daily drip.
/// Circle's Sepolia faucet gives roughly 10 USDC a day, which cannot fund a reserve or even a single
/// premium pack, and that turns "try the product" into a week-long errand.
///
/// Two ways in, deliberately separated:
///   - `claim()`  self-service, {CLAIM_AMOUNT} per address per {CLAIM_COOLDOWN}. What users touch.
///   - `mint()`   unrestricted, for funding reserves and seeding demo wallets. What ops touches.
///
/// `mint` being open is not an oversight: on a testnet there is no value to protect and a permissioned
/// mint would just mean one more key to hold. It is also precisely why the constructor refuses to let
/// this contract exist on a chain where the token would represent money.
contract FaucetStablecoin is ERC20 {
    uint8 private constant DECIMALS = 6;

    /// @notice Handed out per successful {claim}. Enough for a premium pack plus change.
    uint256 public constant CLAIM_AMOUNT = 500e6;

    /// @notice Minimum gap between claims from one address.
    uint256 public constant CLAIM_COOLDOWN = 24 hours;

    /// @notice Cap per {mint} call, so a mistyped amount cannot produce a balance that makes every
    ///         subsequent screenshot and log unreadable.
    uint256 public constant MAX_MINT = 100_000_000e6;

    mapping(address account => uint256 timestamp) public lastClaimedAt;

    event Claimed(address indexed account, uint256 amount);

    error MintTooLarge(uint256 requested, uint256 max);
    error ClaimTooSoon(uint256 availableAt);
    error NotForProductionChains(uint256 chainId);

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        // A faucet token allowlisted on a production PaymentRouter would let anyone mint themselves
        // free packs. The deploy script checks this too; duplicating it here means the guarantee
        // survives someone writing a new script.
        uint256 id = block.chainid;
        if (id == 1 || id == 56 || id == 137 || id == 8453 || id == 42161 || id == 4663) {
            revert NotForProductionChains(id);
        }
    }

    function decimals() public pure override returns (uint8) {
        return DECIMALS;
    }

    /// @notice Sends {CLAIM_AMOUNT} to the caller, once per {CLAIM_COOLDOWN}.
    /// @dev Keyed on `msg.sender` rather than on a signature or an allowlist. A cooldown per address
    ///      is trivially defeated by making more addresses, and that is fine — this protects against
    ///      a UI stuck in a retry loop draining a block's gas, not against a determined farmer, who
    ///      has nothing to gain from test tokens anyway.
    function claim() external {
        uint256 last = lastClaimedAt[msg.sender];
        if (last != 0 && block.timestamp < last + CLAIM_COOLDOWN) {
            revert ClaimTooSoon(last + CLAIM_COOLDOWN);
        }
        lastClaimedAt[msg.sender] = block.timestamp;
        _mint(msg.sender, CLAIM_AMOUNT);
        emit Claimed(msg.sender, CLAIM_AMOUNT);
    }

    /// @notice Seconds until `account` may claim again; zero when it can claim now.
    function claimAvailableIn(address account) external view returns (uint256) {
        uint256 last = lastClaimedAt[account];
        if (last == 0) return 0;
        uint256 ready = last + CLAIM_COOLDOWN;
        return block.timestamp >= ready ? 0 : ready - block.timestamp;
    }

    /// @notice Unrestricted mint for reserve funding and demo setup.
    function mint(address to, uint256 amount) external {
        if (amount > MAX_MINT) revert MintTooLarge(amount, MAX_MINT);
        _mint(to, amount);
    }
}

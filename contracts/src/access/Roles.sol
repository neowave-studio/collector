// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

/// @title Roles
/// @notice Canonical role identifiers for the whole Collector suite (spec §13).
/// @dev These constants are the ONLY source of role ids. Never hardcode a role hash elsewhere.
library Roles {
    /// @dev Held ONLY by the TimelockController (whose proposer/executor is the Safe multisig).
    ///      Gates every value-extracting or trust-assumption-changing action (spec §6.1).
    bytes32 internal constant DEFAULT_ADMIN_ROLE = 0x00;

    /// @dev Ops multisig / KMS. May rotate the *operational* keys below (instant, bounded blast radius §6.3).
    bytes32 internal constant OPERATIONS_ROLE = keccak256("collector.role.OPERATIONS");

    /// @dev Authors pools: `commitPool` (write-once, partition-verified, EV-checked) + announced version switch.
    bytes32 internal constant POOL_AUTHOR_ROLE = keccak256("collector.role.POOL_AUTHOR");

    /// @dev Backend relayer: may call `rip` / `settle`. Has NO authority over reserve withdrawal.
    bytes32 internal constant TRUSTED_RELAYER_ROLE = keccak256("collector.role.TRUSTED_RELAYER");

    /// @dev EIP-712 signer for BuybackAuth. Recovered signer must hold this role.
    bytes32 internal constant TRUSTED_ORACLE_ROLE = keccak256("collector.role.TRUSTED_ORACLE");

    /// @dev Buyback relayer: may submit `settleBuyback`. Separate key from the oracle signer.
    bytes32 internal constant TRUSTED_BUYBACK_ROLE = keccak256("collector.role.TRUSTED_BUYBACK");

    /// @dev Inventory intake: `depositBatch` (instant) and `sweepTo` (Timelock-gated, pending-draw-blocked).
    bytes32 internal constant INVENTORY_ADMIN_ROLE = keccak256("collector.role.INVENTORY_ADMIN");

    /// @dev Reserve funding (instant). `withdrawSurplus` / `setMaxBuybackOutflow` are Timelock-gated.
    bytes32 internal constant TREASURER_ROLE = keccak256("collector.role.TREASURER");

    /// @dev Pay-token allowlist. Held by the Safe, exercised through the Timelock.
    bytes32 internal constant TOKEN_ADMIN_ROLE = keccak256("collector.role.TOKEN_ADMIN");

    /// @dev Platform fee bps, capped in code at MAX_FEE_BPS. Recipient changes are Timelocked.
    bytes32 internal constant FEE_ADMIN_ROLE = keccak256("collector.role.FEE_ADMIN");

    /// @dev Emergency pause/unpause. NEVER affects `claimAfterTimeout` / `refundStuckRip` / `claimUnavailable`.
    bytes32 internal constant PAUSE_ADMIN_ROLE = keccak256("collector.role.PAUSE_ADMIN");

    /// @dev `setBaseURI` on CollectibleNFT.
    bytes32 internal constant METADATA_ADMIN_ROLE = keccak256("collector.role.METADATA_ADMIN");

    /// @dev Mints CollectibleNFT. Held by the intake pipeline.
    bytes32 internal constant MINTER_ROLE = keccak256("collector.role.MINTER");

    /// @dev Granted ONLY to the GachaMachine. The single authority that releases NFTs from the Vault.
    bytes32 internal constant SETTLEMENT_ROLE = keccak256("collector.role.SETTLEMENT");

    /// @dev Granted ONLY to the GachaMachine. reserve/unreserve/pay on ReserveVault.
    bytes32 internal constant GACHA_ROLE = keccak256("collector.role.GACHA");

    /// @dev Granted to GachaMachine + Marketplace. May instruct PaymentRouter to pull user funds.
    bytes32 internal constant PAYMENT_CONSUMER_ROLE = keccak256("collector.role.PAYMENT_CONSUMER");

    /// @dev Fiat-chargeback risk controls: time-boxed transfer / buyback holdbacks (spec §9 FIX C4-backend).
    ///      Powers are duration-capped in code and always event-logged; cannot seize or redirect assets.
    bytes32 internal constant RISK_ADMIN_ROLE = keccak256("collector.role.RISK_ADMIN");
}

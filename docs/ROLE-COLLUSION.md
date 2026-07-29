# Role-collusion threat model

**Spec §8.8 [MUST][AUDIT].** This table is the real least-privilege audit, and the spec gates launch on
a reviewer signing it. For every way the system can lose value, it names **which keys must collude or
be compromised**, and **what bounds the damage even then**.

Read it as an adversary would: find the row with the smallest `N` and attack that.

---

## Loss scenarios

| # | Loss scenario | Keys that must collude | Delay | Residual bound on the damage |
|---|---|---|---|---|
| 1 | **Drain the buyback reserve** | `POOL_AUTHOR` (commit a deliberately over-priced pool) **+** `TRUSTED_ORACLE` (sign inflated payouts) **+** `TRUSTED_BUYBACK` (submit them) — **3 keys** | none | `commitPool` rejects any pool whose weighted expected buyback exceeds the rip price net of house margin, so the over-pricing must survive an on-chain EV check. Each payout is then capped at `buybackBps × priceRef` of the *actually drawn* card, must land inside the buyback window, and the ReserveVault enforces `maxBuybackOutflowPerEpoch`. **Maximum bleed before a pause lands: one epoch's cap.** |
| 2 | **Withdraw the reserve directly** | `TREASURER` **+** Safe quorum (≥3-of-5) | **48 h** | `withdrawSurplus` can only take value above `reservedLiabilities × (1 + surplusBufferBps)`. Every outstanding user obligation is untouchable, and the queued transaction is publicly visible for two days. |
| 3 | **Arbitrary code change (steal everything)** | Safe quorum (≥3-of-5 hardware signers) | **48 h** | The only unbounded path in the system. Mitigated by the delay being public, by `TimelockQueued` alerting, and by the re-audit-on-upgrade rule. Users who object have two days to exit. |
| 4 | **Rig which card a draw pays out** | **Not reachable.** | — | `commitPool` builds the Merkle root *itself* from leaves it verified tile `[0, totalWeight)` exactly once. Exactly one leaf can contain any given VRF weight, and `settle` reads `packId`/`poolVersion` from the stored draw, never from calldata. No key changes this. |
| 5 | **Change the odds after a user has paid** | **Not reachable.** | — | A committed `(packId, version)` is write-once; `rip` stores the version atomically; the user's own signature pins it and `rip` reverts on mismatch; `setActivePoolVersion` cannot take effect in the same block. |
| 6 | **Move a specific card to an attacker** | `INVENTORY_ADMIN` **+** Safe quorum | **48 h** | `sweepTo` is blocked entirely while the card's pack has **any** unresolved draw, and every sweep emits `Swept` which pages ops. |
| 7 | **Overcharge a user for a rip** | **Not reachable.** | — | `PurchaseAuth` is signed by the user and pins `payToken`, `amountPerRip`, `numRips` and `poolVersion`. A compromised relayer can only submit exactly what the user agreed to. |
| 8 | **Sell packs that cannot be honoured** | **Not reachable.** | — | `rip` books the pool's worst-case payout with the ReserveVault first and reverts if it cannot be covered. |
| 9 | **Strand a paid user (censorship / ransom)** | **Not reachable.** | — | `claimAfterTimeout`, `claimUnavailable` and `refundStuckRip` are permissionless and **not** `whenNotPaused`. `PAUSE_ADMIN` cannot reach them; `Vault.releaseTo` and `ReserveVault.unreserve` are likewise unpausable. |
| 10 | **Redirect platform fee revenue** | `DEFAULT_ADMIN` (= Timelock) **+** Safe quorum | **48 h** | Future revenue only. Cannot touch escrow, reserve obligations, or anyone's card. |
| 11 | **Add a hostile pay token** (fee-on-transfer / rebasing, to corrupt reserve accounting) | `TOKEN_ADMIN` **+** Safe quorum | **48 h** | Publicly visible for 48 h; the allowlist policy forbidding non-standard ERC-20s is the control being exercised. |
| 12 | **Freeze a user's assets** | `RISK_ADMIN` — **1 key** | none | Deliberately instant, because a chargeback wave needs a fast response. Bounded in code: `setTransferLock` and `setBuybackLock` are capped at `MAX_TRANSFER_LOCK` / `MAX_BUYBACK_LOCK` (150 days) from now, cannot move, burn or redirect a token, and never block card **delivery** — only transfer, redemption and cash-out. Worst case for a false positive: the user waits. |
| 13 | **Halt the platform (denial of service)** | `PAUSE_ADMIN` — **1 key** | none | Instant by design. Bounded: it cannot touch the escape hatches in row 9, so a hostile pauser can stop *new* business but cannot hold existing users hostage. Unpausing requires the ops multisig. |
| 14 | **Mint a fake card** | `MINTER` — **1 key** | none | The fake still cannot enter a pool: `commitPool` requires every tokenId to be vault-held and earmarked to that pack, and the certificate commitment is unique and write-once. Detected by `Minted` events reconciled against the grading intake. |
| 15 | **Forge a settlement proof** | **Not reachable.** | — | Requires a keccak-256 preimage collision. |
| 16 | **Replay a signature onto another chain** | **Not reachable.** | — | EIP-712 domain binds `chainId` + `verifyingContract`; `test/unit/CrossChainReplay.t.sol` is the CI gate. |

---

## What the shape of this table says

**The three single-key rows (12, 13, 14) are single-key on purpose.** Each is an *operational* power
that must act inside minutes during an incident, and each is bounded in code so that a compromise
costs time or noise, never user property. Putting a 48-hour delay on "pause during an exploit" would
be worse than the risk it removes.

**Everything that can extract value needs a multisig plus a public delay.** Rows 2, 3, 6, 10 and 11
are the complete list of value-extracting actions, and all five run through the Timelock.

**The smallest attack on user funds is row 1, at three independent KMS keys**, and even fully
successful it is capped at one epoch's outflow. Set `maxBuybackOutflowPerEpoch` deliberately: it is
the number that converts "the reserve is gone" into "we lost one epoch's worth and the reconciler
paused us."

---

## Sign-off

Launch requires this table to be reviewed against the deployed bytecode, not against this document.

| Role | Name | Date | Signature |
|---|---|---|---|
| Smart contract auditor (firm 1) | | | |
| Fairness / economics auditor (firm 2) | | | |
| Backend & infrastructure reviewer | | | |
| Engineering owner | | | |

**Reviewers must specifically confirm:**

1. `SETTLEMENT_ROLE` and `GACHA_ROLE` have exactly one holder each, and it is the GachaMachine
   (`invariant_settlementAuthorityStaysWithTheGachaMachineAlone` asserts this continuously).
2. `DEFAULT_ADMIN_ROLE` has exactly one holder and it is the TimelockController — never an EOA.
3. The Timelock's proposer and executor are the Safe, and the Safe's signers are hardware wallets held
   by distinct people.
4. `maxBuybackOutflowPerEpoch` is set on every pay token. **Zero means no sell-back at all** (fail
   closed), so an unset value is a service outage, not a security hole — but it must be a deliberate
   number, not a default.
5. No operational key holds `TREASURER_ROLE`, `TOKEN_ADMIN_ROLE` or `DEFAULT_ADMIN_ROLE`.

# Deviations from TECHNICAL-SPEC.md v1.1

Every place this implementation differs from the spec, why, and what it costs. Nothing here is
accidental; if you disagree with a call, this is the list to argue with.

Grouped by how much they matter.

---

## 1. Gaps found in the spec, and what was added

### 1.1 Pool exhaustion — the spec had no answer, and it strands users' money

**The hole.** A pool version maps every weight to a specific `tokenId`. Two draws can land on the same
slice. The first one takes the card; the spec's `settle` then reverts forever for the second, because
`Vault.releaseTo` fails on a token it no longer holds. That user has paid, their draw is revealed and
unsettleable, and `refundStuckRip` does not apply because the draw *was* revealed. Their money is
stuck permanently.

This is not an edge case — with a 1,000-card pool it starts happening at a few thousand rips, and it
gets worse as inventory depletes.

**What was added.**

1. **`claimUnavailable(drawId, leafProof)`** — permissionless and unpausable. Verifies the same Merkle
   proof as `settle`, additionally requires that the card really has left the vault, and pays
   `unavailableBps × priceRef` from the reservation booked at rip time. Default `unavailableBps` is
   100%, so an undeliverable card pays its full committed reference value, not the 85% sell-back rate.
2. **`maxReservePerRip = maxPriceRef × unavailableBps / BPS`** replaces the spec's `poolMaxBuyback` as
   the amount actually reserved, with `unavailableBps ≥ buybackBps` enforced at commit. That single
   reservation covers whichever resolution occurs, so a compensation can never be unbacked.
3. **A staleness circuit breaker** — `rip` reverts with `PoolStale` once `releasedCount / cardCount`
   exceeds `poolStaleThresholdBps`. Published odds stop describing what is deliverable long before the
   pool empties, so ops must commit a new version rather than sell into a depleting one.

**Cost.** More capital locked per outstanding rip (`maxPriceRef`, not `buybackBps × maxPriceRef`), and
one more resolution path to audit. Both worth it: the alternative is a class of users whose funds are
gone with no recourse.

`DrawUnavailable` is alerted on, because a healthy system should almost never emit it.

### 1.2 `sweepTo` cannot check what the spec asks it to

**Spec §5.2 (FIX M4-sec)** says `sweepTo` must revert if the tokenId is "the target of a
revealed-but-unsettled draw." On-chain, nothing knows a revealed draw's target — the winning tokenId
is only recoverable by walking the pool off-chain and presenting a Merkle proof. The stated check is
not computable.

**Implemented instead:** `sweepTo` reverts while the token's pack has **any** unresolved draw
(`GachaMachine.pendingDraws(packId) != 0`). Strictly stronger than the spec's intent and actually
enforceable. Ops drain a pack by pausing rips and waiting out the timeouts.

### 1.3 `settle` was permissionless during the window the user needs to decide

The spec makes `settle` permissionless. But a permissionless `settle` during the sell-back window lets
any griefer force delivery and destroy the user's cash-out option.

**Implemented:** during the buyback window, `settle` is restricted to the draw's user or the relayer.
Once the window closes it is fully permissionless, and `claimAfterTimeout` (unpausable) covers the
same period. The escape-hatch guarantee is unchanged; the user's choice is protected.

### 1.4 Unbounded `version` could truncate

`PurchaseAuth.poolVersion` is `uint256`, but `Draw` packs it into `uint128` for gas. Two versions
differing only above 2^128 would collide inside a draw record. `commitPoolStart` now rejects
`version > type(uint128).max`. Found by a compiler truncation warning; the test suite would not have
caught it.

### 1.5 Hand-rolled `ecrecover` had a malformed malleability constant

The first implementation of the oracle-signature recovery used a hand-written `s` upper-bound that was
28 bytes instead of 32, rejecting most valid signatures. Replaced with OpenZeppelin's `ECDSA.tryRecover`.
Caught by `Buyback.t.sol` — a good argument for not hand-rolling this.

---

## 2. Deliberate structural differences

### 2.1 `PoolCommitLib` is a linked `delegatecall` library

The combined GachaMachine exceeded EIP-170 (24,576 bytes) by ~3.2 KB. The commitment machinery moved
into a library that runs in the GachaMachine's own storage and address context — events, errors and
access control are identical to an inline implementation.

The alternative (a separate `PoolRegistry` contract) would have added an external call to `settle`,
which is the hot path. **Cost:** deployment must record the library address and Etherscan verification
must pass `--libraries`. Current size: 24,055 / 24,576.

### 2.2 `via_ir` is on

Required — the settlement paths carry more live locals than the legacy pipeline's stack window allows.
Also buys ~15% smaller bytecode, which is what fits the contract under the limit.

### 2.3 Leaf hashes are kept on-chain rather than deleted

`finalizePool` does not clear the accumulated leaf hashes. They are already paid for, and keeping them
lets anyone re-check a published pool file leaf-by-leaf straight from chain state even if every IPFS
pin disappears. An aborted draft's version number is **retired** rather than freed, because clearing a
20,000-entry array is unbounded gas and silently reusing the number would let a restarted draft append
to abandoned leaves.

### 2.4 `payFromReservation` merges the spec's `pay` + `releaseRemainder`

One atomic call, so the vault is never observable in a state where a paid-out draw still carries its
full reservation.

### 2.5 Rip revenue partly funds the reserve

Added `reserveBps` per pool version: at resolution the escrowed rip price splits between the
ReserveVault and the treasury, flushed by a permissionless `flushRevenue`. Without this the reserve is
only ever fed by manual top-ups, which makes solvency an operational chore rather than a property of
the product.

### 2.6 Permit2 has an allowance fallback

`PaymentRouter` accepts `permit2 == address(0)` and falls back to a plain allowance pull. Permit2 is
not deployed on every EVM chain — including new ones like Robinhood Chain, which the brief explicitly
asks to support. This is safe because the charged amount is always bounded by the user's own EIP-712
`PurchaseAuth`, and `collect*` is restricted to `PAYMENT_CONSUMER_ROLE`.

### 2.7 Marketplace listings and offers use different typehashes

The spec's single `Order` struct would let a seller's listing signature be replayed as a bid over the
same fields. Same pattern the spec itself uses for `BuybackAuth` / `BuybackUser`.

---

## 3. Smaller differences

| Spec | Implementation | Why |
|---|---|---|
| BullMQ for background jobs | Interval loops + Postgres advisory locks | The work is all "reconcile against chain state" — idempotent and self-healing, so a missed tick just does more next time. A durable queue would add a second source of truth about what has been processed without adding a guarantee. Genuinely retry-shaped jobs (email, shipment dispatch) should use BullMQ when they land. |
| `poolCID` as `bytes32` | `keccak256(cid)` stored on-chain | A CIDv1 does not fit in 32 bytes. Verification is "hash the CID you were given and compare", which still binds the file because a CID is itself a content hash. |
| `mapping vrfRequestToDraw` | `mapping(uint256 => VRFRequest{firstDrawId, count})` | Supports multi-rip in one VRF request. Draw ids are sequential, so this is strictly cheaper than an array. |
| `Draw.poolVersion` as `uint256` | `uint128` (+ bound at commit, §1.4) | Packs `Draw` into 4 slots instead of 6. |
| Timelock-gated role grants in the deploy script | Script deploys, then **prints** the governance checklist | Granting from the deployer key would mean minting a privileged EOA "just for setup" — precisely the thing §6 exists to prevent. |

---

## 4. Not implemented (and honestly so)

These are spec requirements this build does **not** satisfy. None can be closed by writing more code
here; each needs a decision, a vendor, or a third party.

| Spec | Status | What is needed |
|---|---|---|
| §7.3 — ≥2 external audits | **Not done** | Cannot be self-performed. The suite is audit-*ready*: 148 tests, 12 invariants, storage-layout gate, role-collusion table. |
| §7.3 — Certora / SMTChecker formal verification | **Not done** | Foundry invariants cover the same properties empirically (solvency, single-settlement, partition uniqueness). Formal proof is a separate engagement. |
| §7.3 — Immunefi bug bounty | **Not done** | Requires a funded programme. |
| §8.6 — KMS/HSM signing | **Boundary, not stub** | `createKmsSigner` throws rather than silently falling back to an in-process key, and `config.ts` refuses to boot production with `SIGNER_MODE=local`. Needs `@aws-sdk/client-kms` plus DER decode, low-`s` normalisation and recovery-id search. |
| §8.2 — Arweave permanence | **Boundary, not stub** | IPFS pinning works; `archiveToArweave` logs a warning and returns undefined. Needs a funded Arweave wallet. Production refuses to commit a pool with fewer than 2 IPFS pins. |
| §12 — KYC / age / jurisdiction provider | **Interface only** | `compliance.ts` implements the full gate and fails closed; it reads from the `kyc` table. A provider (Persona/Sumsub/etc.) must populate it. Production will not boot without `KYC_PROVIDER_URL`. |
| §12 — legal sign-off per jurisdiction | **Not done** | `GACHA_BLOCKED_JURISDICTIONS` is a placeholder that production refuses to start with empty. **Counsel sets this list, not engineering.** |
| §8.6 — WORM audit-log export | **Schema only** | `audit_log.exported` exists; the shipper to cross-account S3 Object Lock does not. |
| §9 — MoonPay production credentials | **Sandbox** | Signing and webhook verification are complete and tested; the account is not. |
| §3 — Robinhood Chain deployment | **Registry entry, marketplace-only** | Its `chainId`, RPC, USDC and Permit2 addresses are not public. The entry is `chainId: 0` so the deploy script refuses to run against it, and `gachaEnabled: false` because there is no VRF v2.5 — spec §3 (FIX H6) forbids real-money gacha without it. |

---

## 5. The one thing worth escalating

§12 is a launch blocker, and it is not an engineering one.

Paid random-outcome packs with an instant cash sell-back is the fact pattern regulators look at
hardest — the buyback is what turns "randomised retail purchase" into something a gambling or
money-transmission regime may recognise. The code is built to make the compliance controls real
(gate before payment, on verified jurisdiction, fail closed, logged per rip, self-exclusion) but it
cannot tell you which jurisdictions to allow.

Get counsel's answer per target market before launch, not after. Everything else here can ship on an
engineering timeline; this cannot.

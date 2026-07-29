# Incident runbooks

**Spec §8.9 [MUST].** Runbooks plus periodic drills. Each one states the containment step *first*,
because during an incident the ordering is the whole value of the document.

Two facts that apply to every runbook below and should shape every judgement call:

- **Pausing never strands a user.** `claimAfterTimeout`, `claimUnavailable`, `refundStuckRip`,
  `Vault.releaseTo` and `ReserveVault.unreserve` are not `whenNotPaused`. When in doubt, pause.
- **A compromised operational key cannot take user funds.** No hot key can reach `withdrawSurplus`,
  `setTreasury`, the pay-token allowlist or an upgrade. Those are Safe + 48 h, always.

---

## 1. Compromised relayer, oracle or buyback key

**Contain (minutes):**

```bash
# 1. Pause inflows. PAUSE_ADMIN is the ops multisig; instant by design.
cast send $RESERVE_VAULT "pause()" --account ops-multisig
cast send $GACHA_MACHINE "pause()" --account ops-multisig

# 2. Rotate the key. OPERATIONS holds the role admin for all three hot roles, so no Timelock wait.
cast send $ACCESS_CONTROLLER "revokeRole(bytes32,address)" $TRUSTED_RELAYER_ROLE $OLD --account ops
cast send $ACCESS_CONTROLLER "grantRole(bytes32,address)"  $TRUSTED_RELAYER_ROLE $NEW --account ops
```

**Then:**

3. `SIGNER_MODE=kms` — disable the compromised KMS key id in AWS and check CloudTrail for `Sign`
   calls from unexpected principals.
4. Query `reconciliation_events` and the `Paid` event stream for the compromise window.
5. Bound the loss: buyback outflow this epoch cannot exceed `maxBuybackOutflowPerEpoch`. Read
   `outflowRemaining(token)` to see how much was actually used.

**What the attacker could NOT do**, and should be stated plainly in any incident report: change odds,
alter which card a draw pays, overcharge a user beyond their signed `PurchaseAuth`, withdraw the
reserve, or block anyone from claiming their card.

**Unpause** only after the reconciler reports zero divergence for three consecutive passes.

---

## 2. Reserve divergence (chain ↔ DB)

Fires as `reserve_divergence` or `insolvent_reserve`. `insolvent_reserve` should be **unreachable**
through the contracts — observing it means something outside them is wrong. Treat it as the highest
severity in this document.

**Automatic:** the reconciler pauses the ReserveVault when `RECONCILER_AUTOPAUSE=true`. Confirm it
actually landed — `buyback_auto_pause_FAILED` means the relayer lacks `PAUSE_ADMIN_ROLE` and **you
must pause from the Safe immediately**.

**Diagnose:**

```sql
SELECT * FROM reconciliation_events ORDER BY detected_at DESC LIMIT 20;
SELECT * FROM reserve_ledger WHERE chain_id = :chain;
```

```bash
cast call $RESERVE_VAULT "proofOfReserves(address)" $USDC
```

The DB is a **cache**; the chain is authoritative. Rebuild it rather than patching it:

```bash
psql -c "UPDATE chains SET last_indexed_block = <deployment_block> WHERE chain_id = :chain;"
psql -c "DELETE FROM reserve_ledger WHERE chain_id = :chain;"
npm run worker   # replays every event from deployment
```

If the rebuilt ledger matches the chain, the cause was a missed or mis-applied event — fix the
indexer, then unpause. **If it still diverges, do not unpause.** The reserve is genuinely wrong and
that is a code or key incident, not a caching one.

---

## 3. VRF outage

**Symptom:** `vrf_stuck_draws`, draws sitting in `requested` past `ripRevealTimeout`.

Users are not at risk — the payment is escrowed and refundable. Order of operations:

1. Check the Chainlink subscription balance and that the GachaMachine is still a consumer.
2. Pause `rip` (`GachaMachine.pause()`) so no further draws enter a queue that cannot resolve.
3. Refund the stuck draws on users' behalf — `refundStuckRip` is permissionless, so any funded key
   works, including one with no roles at all:

```bash
for id in $STUCK_DRAW_IDS; do
  cast send $GACHA_MACHINE "refundStuckRip(uint256)" $id --account ops
done
```

4. Tell users plainly: their money is on-chain, refundable by anyone, and the transaction is available
   at `/draws/:chainId/:drawId/self-settle` and from the offline tool.

Do not unpause until VRF has been answering for a sustained period — a flapping subscription generates
refunds faster than support can explain them.

---

## 4. MoonPay chargeback wave

**Symptom:** repeated `moonpay_chargeback` alerts, or a spike in
`moonpay_webhook_signature_failure_spike` (which is either a rotated secret or someone forging
`completed` events).

1. Identify the affected wallets: `SELECT * FROM moonpay_orders WHERE chargeback_state <> 'none'`.
2. Apply the on-chain holdbacks. Both are duration-capped in code and **cannot** move, burn or
   redirect anyone's card — they only delay exit:

```bash
cast send $GACHA_MACHINE  "setBuybackLock(address,uint64)"  $USER $UNTIL --account risk-admin
cast send $COLLECTIBLE_NFT "setTransferLock(uint256,uint64)" $TOKEN $UNTIL --account risk-admin
```

3. If the card is still held, claw back via a Marketplace purchase — **never** via `sweepTo`, which is
   for mis-mints and is Timelocked anyway.
4. Revoke sessions: `revokeAllSessions(address)`.
5. If the wave is broad, tighten `FIAT_CHARGEBACK_HOLDBACK_DAYS` and consider disabling the on-ramp
   entry point until the pattern is understood.

**Prevention, restated:** we deliberately use MoonPay's on-ramp to the user's own wallet rather than
NFT Checkout, so card-fraud risk sits with MoonPay — who priced it — instead of with our reserve.
Enabling Flow 2 changes that; do not enable it without per-user value limits and a risk score.

---

## 5. Upgrade and rollback

**Upgrade** (spec §11.6 — the 48 h window is a trust feature, so announce it):

1. Safe proposes `upgradeToAndCall` on the Timelock.
2. CI must be green: `node script/check-storage-layout.mjs` **and** a re-audit of the new
   implementation. A UUPS upgrade is new code; treat it as such.
3. Announce publicly at proposal time, not at execution time.
4. Execute after 48 h.

**Rollback:** the previous implementation is still deployed, so a rollback is another
`upgradeToAndCall` back to it — and it takes the same 48 h. **There is no fast path.** If you need an
emergency stop, that is what `pause()` is for; pausing is instant and does not require an upgrade.

If an upgrade shipped a storage-layout bug, do **not** upgrade again to "fix" it — pause first, work
out what the corrupted slots now mean, then plan a migration. A second layout change on top of a bad
one usually destroys the evidence.

---

## 6. Reorg deeper than configured confirmations

**Symptom:** `reorg_exceeded_configured_depth`.

This means `confirmations` for that chain is set too low — a configuration incident, not a routine
event. The per-chain depths in `contracts/script/chains.json` are set above known reorg depths
(Polygon 128, BNB 30) precisely to avoid it.

1. Raise `confirmations` for the chain.
2. Rewind and replay: `handleReorg` already deletes settlements past the fork point and reopens the
   affected idempotency keys, but verify `draws` and `settlements` agree with the chain afterwards.
3. Money actions are safe by construction — the on-chain single-settlement guard makes a duplicate
   submission a no-op — but check `idempotency_keys` for anything stuck in `submitted`.

---

## 7. Drill schedule

Runbooks that have never been executed are fiction. Quarterly, on a testnet deployment:

| Drill | Success criterion |
|---|---|
| Key rotation | Relayer rotated and rips flowing again in under 10 minutes |
| Reserve divergence | Auto-pause fires; ledger rebuilds from events and matches the chain |
| VRF outage | All stuck draws refunded; no user opens a support ticket about lost funds |
| **Kill the backend** | A fresh wallet settles a draw using only the offline tool and public chain data |
| Chargeback | Holdbacks applied; the user's card delivery is confirmed unaffected |
| Upgrade + rollback | Both complete through the Timelock with a green storage-layout gate |

The kill-the-backend drill is the one that matters most and is easiest to let slide. It is covered
continuously by `contracts/test/unit/OfflineSelfSettle.t.sol`, which feeds calldata produced by the
offline CLI into the real contract with everything paused — but run it by hand too, on a real
deployment, with a wallet that has never touched the site.

---

## Appendix — completing the deferred integrations

**KMS signer** (`backend/src/services/signer.ts`). Install `@aws-sdk/client-kms`; sign the EIP-712
digest with `SignCommand` (`MessageType: 'DIGEST'`, `SigningAlgorithm: 'ECDSA_SHA_256'`); decode the
DER `(r, s)`; normalise `s` to the lower half-order; recover `v` by trying 27 and 28 and comparing the
recovered address to the key's known address. It currently **throws** rather than falling back to a
local key — keep it that way.

**Arweave** (`backend/src/services/publish.ts`). Install `arweave`, fund a wallet, upload the same
canonical bytes that were pinned to IPFS, and store the transaction id in `pool_versions.arweave_tx`.
IPFS pins expire; a pool file that expires takes a user's ability to self-settle with it.

**WORM audit export.** Stream `audit_log` rows where `NOT exported` to a cross-account S3 bucket with
Object Lock, then mark them exported. The point is tamper-evidence against a database administrator,
so the destination account must not be one the application can write to directly.

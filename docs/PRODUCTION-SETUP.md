# Production setup — everything you need to procure

Run `cd backend && npm run preflight` at any point. It connects to your database, Redis, RPCs and
KMS, reads the on-chain role table and reserve balances, and prints a go/no-go with a fix line for
every blocker. **That command is the real checklist**; this document explains where each value comes
from and how long it takes to get.

Ordered by lead time, because two of these gate everything else.

---

## Start these first — they have external lead times

| Item | Where | Lead time | Blocks |
|---|---|---|---|
| **Legal opinion per market** | Gambling/fintech counsel | **2–6 weeks** | `GACHA_BLOCKED_JURISDICTIONS`, and whether you can launch at all |
| **Smart-contract audits ×2** | e.g. Spearbit, OpenZeppelin, Trail of Bits, Cantina | **3–8 weeks** | Mainnet deployment |
| **MoonPay production account** | business.moonpay.com | **1–3 weeks** | Live keys + webhook secret |
| **KYC/AML vendor** | Persona, Sumsub, Onfido, Veriff | **1–2 weeks** | `KYC_PROVIDER_URL`, every rip |

Everything below can be done in an afternoon once these are moving.

---

## 1. Signing keys — AWS KMS

Four keys, one per role. Separate keys are what make the collusion table in
[ROLE-COLLUSION.md](ROLE-COLLUSION.md) true — the backend refuses to start if any two resolve to the
same address.

```bash
for role in oracle relayer buyback pool-author; do
  aws kms create-key \
    --key-spec ECC_SECG_P256K1 --key-usage SIGN_VERIFY \
    --description "collector-$role" \
    --query 'KeyMetadata.KeyId' --output text
done
```

Grant the backend's task role **only** `kms:Sign` and `kms:GetPublicKey` on these four keys, and
alarm on `kms:Sign` from any other principal.

```env
SIGNER_MODE=kms
AWS_REGION=us-east-1
KMS_ORACLE_KEY_ID=...
KMS_RELAYER_KEY_ID=...
KMS_BUYBACK_KEY_ID=...
KMS_POOL_AUTHOR_KEY_ID=...
```

`npm run preflight` prints the derived address for each key. **Fund the relayer, buyback and
poolAuthor addresses with gas on every chain** — the oracle only signs and never sends, so it needs
none.

## 2. Safe multisig + deployer

| Value | Where |
|---|---|
| `SAFE_ADDRESS` | app.safe.global — **≥3-of-5, hardware wallet signers, different people**. Deploy it at the same address on every chain. |
| `OPS_ADDRESS` | A second Safe (or ops multisig) that rotates hot keys without a timelock |
| `TREASURY_ADDRESS` | Where platform fees and rip revenue land |
| `ROYALTY_RECEIVER` | EIP-2981 recipient |
| `DEPLOYER_PRIVATE_KEY` | A throwaway funded EOA. It holds **no** role after deployment — the script hands `DEFAULT_ADMIN` to the Timelock and prints the grants for you to queue through the Safe. |

## 3. Chainlink VRF

Per chain at [vrf.chain.link](https://vrf.chain.link):

1. Create a subscription → gives you `VRF_SUBSCRIPTION_ID`.
2. Fund it with LINK or native (the registry sets `nativePayment: true`).
3. **Add the deployed GachaMachine as a consumer.** Miss this and every `rip` reverts.

Coordinator addresses and key hashes are already in
[contracts/script/chains.json](../contracts/script/chains.json) — verify them against the Chainlink
docs at deploy time, since they do change between VRF versions.

## 4. RPC endpoints

Alchemy, QuickNode, Infura, or your own nodes. Public RPCs will rate-limit you into what looks like an
outage.

```env
ENABLED_CHAINS=base
BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/<key>
# plus POLYGON_/ARBITRUM_/BNB_/ETHEREUM_RPC_URL for whichever chains you enable
```

Also `ETHERSCAN_API_KEY` (one key now covers all chains via Etherscan V2) for contract verification.

## 5. Database, cache, secrets

```env
DATABASE_URL=postgres://user:pass@host:5432/collector   # Postgres 16, RDS/Neon/Supabase
REDIS_URL=rediss://...                                  # ElastiCache/Upstash, AOF persistence on
SESSION_SECRET=<openssl rand -base64 32>
PUBLIC_ORIGIN=https://collector-cards.com
```

Redis backs rate limiting, which **fails closed** — if it is unreachable the API rejects traffic
rather than running unmetered. Treat it as a hard dependency, not a cache.

## 6. MoonPay

From the production dashboard:

```env
MOONPAY_API_KEY=pk_live_...
MOONPAY_SECRET_KEY=sk_live_...          # signs widget URLs, never sent to the browser
MOONPAY_WEBHOOK_SECRET=whsec_...        # verifies inbound webhooks
MOONPAY_WIDGET_BASE=https://buy.moonpay.com
FIAT_CHARGEBACK_HOLDBACK_DAYS=120
```

Register the webhook at `https://api.yourdomain.com/moonpay/webhook`. Ask for **On-Ramp only** —
NFT Checkout is disabled in code because it moves card-fraud risk onto your reserve.

## 7. KYC / compliance

The gate has three postures, because the requirement is driven by the **product shape**, not the
payment rail. What creates it is *pay money → random outcome → **we** pay cash back out*. Remove that
last leg and the posture changes.

| `COMPLIANCE_MODE` | Sell-back | What users go through | KYC vendor |
|---|---|---|---|
| `full` | live | Document verification, jurisdiction, age, cash-out tier | required |
| `age_only` | **off** | Tick "I'm 18+", IP jurisdiction check | not needed |
| `off` | live | Nothing | not needed — **testnet only** |

```env
# testnet
COMPLIANCE_MODE=off

# sealed-pack product (no sell-back)
COMPLIANCE_MODE=age_only
GACHA_BLOCKED_JURISDICTIONS=BE,NL,...
MIN_AGE_YEARS=18

# full product (sell-back live)
COMPLIANCE_MODE=full
KYC_PROVIDER_URL=https://api.withpersona.com/api/v1
KYC_PROVIDER_API_KEY=persona_...
GACHA_BLOCKED_JURISDICTIONS=US-WA,US-HI,BE,NL,...   # ← from counsel, not from us
```

**`off` cannot reach real money.** Two independent guards, because they fail differently:

- `config.ts` refuses `off` when `NODE_ENV=production` — catches promoting a testnet config;
- `assertComplianceModeIsSafe` refuses `off` when **any enabled chain is a mainnet** — catches a
  plausible-looking `NODE_ENV=staging` pointed at Base mainnet, which the first guard would wave through.

`NODE_ENV` is a label a human types. A chain id is not.

Self-exclusion is honoured in **every** mode, `off` included. A user who asked us to stop letting them
play is not a compliance formality a config flag may switch off.

The frontend shows a persistent testnet banner whenever the gate is disabled, so a demo build cannot
be mistaken for a live one.

The gate reads verified jurisdiction and age from the `kyc` table. **You still need a small webhook
handler that writes your vendor's verification results into that table** — roughly 50 lines, and the
only integration this repo cannot pre-write because it is vendor-shaped. The table contract:

```sql
INSERT INTO kyc (user_address, provider_ref, status, jurisdiction, age_verified, fiat_cashout_tier)
VALUES (lower($1), $2, 'approved', 'GB', true, 1)
ON CONFLICT (user_address) DO UPDATE SET ...;
```

`fiat_cashout_tier >= 1` is required for sell-back (a stricter tier than opening a pack, per §12).

## 8. IPFS pinning — at least two

Pinata, web3.storage, Filebase, or your own Kubo nodes. Two independent services is a hard
requirement: the pool file is how users verify the odds, and one expired pin removes that.

```env
IPFS_PIN_ENDPOINTS=https://api.pinata.cloud/pinning/pinFileToIPFS,https://api.web3.storage/upload
```

Arweave (permanent, unlike a pin) is not wired up — see [RUNBOOKS.md](RUNBOOKS.md#appendix) for the
~30 lines and a funded wallet.

## 9. Alerting

```env
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/...
RECONCILER_AUTOPAUSE=true
```

Every runbook begins with an alert. Without this, reserve divergence and drain detection go to stdout.

## 10. Frontend

```env
NEXT_PUBLIC_API_URL=https://api.collector-cards.com
NEXT_PUBLIC_DEFAULT_CHAIN_ID=8453
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=      # cloud.reown.com, free
NEXT_PUBLIC_BASE_RPC_URL=...
```

---

## Deployment order

```bash
# 1. Deploy the library, then the suite
cd contracts
forge create src/libraries/PoolCommitLib.sol:PoolCommitLib --rpc-url base --private-key $DEPLOYER_PRIVATE_KEY
CHAIN_KEY=base forge script script/Deploy.s.sol:Deploy --rpc-url base --broadcast --verify \
  --libraries src/libraries/PoolCommitLib.sol:PoolCommitLib:<address>

# 2. Queue the printed grants through Safe → Timelock. THIS TAKES 48 HOURS. Start it immediately.
#    setAllowedPayToken and setMaxBuybackOutflow are on this path too.

# 3. Add the GachaMachine as a Chainlink VRF consumer.

# 4. Backend
cd ../backend && npm run migrate && npm run preflight

# 5. Fund the reserve. rip() reverts while it cannot back a pack's worst case.

# 6. Author the first pool, then schedule its activation.

# 7. npm run preflight   → must be zero blockers
```

**Budget 48 hours for step 2 and start it on day one.** The Timelock delay is not skippable, and
forgetting `setMaxBuybackOutflow` means sell-back is silently dead on launch day (it fails closed).

---

## Sizing the reserve

Each rip books its pool's **worst case** up front: `maxPriceRef × unavailableBps / 10000`. For a
50 USDC pack whose grail has a 800 USDC reference price, that is 800 USDC locked per outstanding rip.

Draws resolve in a minute or two, so this is a float, not a balance:

```
reserve ≈ peak_concurrent_rips × maxPriceRef × 2
```

100 concurrent rips on that pack ≈ **160,000 USDC**. Two levers if that is too heavy: cap the grail's
reference price, or split expensive cards into their own higher-priced pack. `reserveBps` then routes
part of each rip's revenue back into the reserve, so it becomes self-sustaining as volume grows.

---

## What is still genuinely missing

Everything above is procurement. These need code or a third party:

1. **KYC webhook handler** — ~50 lines, vendor-shaped. Say which vendor and I will write it.
2. **Arweave archiving** — ~30 lines plus a funded wallet.
3. **WORM audit-log export** — a small shipper to a cross-account S3 bucket with Object Lock.
4. **External audits** — cannot be self-performed.
5. **Legal sign-off** — cannot be self-performed.

Items 1–3 I can complete as soon as you name the vendors. Items 4–5 are the actual gate on taking
real money, and no amount of engineering closes them.

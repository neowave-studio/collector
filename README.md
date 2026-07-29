# Collector

A marketplace for graded physical trading cards, with provably-fair gacha packs on top.

Cards live in a vault and are represented 1:1 on-chain. You can buy and sell them, rip a pack for a
randomized one, sell a pull straight back at a published price, or burn the token to have the physical
card shipped to you.

The whole competitive claim is that **fairness, solvency and non-rug-capability are provable on-chain
rather than promised** — so every statement below names the thing that makes it true.

---

## The four claims, and where they are enforced

| Claim | Enforced by | Test |
|---|---|---|
| **The odds were fixed before you bought and cannot be edited** | `commitPool` BUILDS the Merkle root itself from leaves it verified tile `[0, totalWeight)` exactly once. Write-once per `(packId, version)`; a switch cannot take effect in the same block; your signature pins the version and `rip` reverts on mismatch. | `PoolCommit.t.sol` (20 tests) |
| **Nobody chooses which card you get** | Chainlink VRF v2.5 → rejection-sampled to a weight with no modulo bias → exactly one leaf can contain it → `settle` verifies the Merkle proof and reads `packId`/`poolVersion` only from the stored draw. | `RandomLib.t.sol`, `DrawLifecycle.t.sol` |
| **The sell-back you were offered is funded** | `rip` books the pool's worst case with the ReserveVault **before** you are told a sell-back exists, and reverts if it cannot be covered. Admins can only withdraw above obligations plus a buffer, after 48 h. | `invariant_reserveSolvency`, `ReserveVault.t.sol` |
| **You can take your card without us** | `claimAfterTimeout`, `claimUnavailable` and `refundStuckRip` are permissionless and **not** pausable. A dependency-free offline tool builds the transaction. | `OfflineSelfSettle.t.sol` — CLI-generated calldata settles a draw with the whole system paused |

That last row is the one to check first. `contracts/test/unit/OfflineSelfSettle.t.sol` takes calldata
produced by `tools/proof-generator/cli.mjs` — a file with no dependencies that implements keccak-256
from the spec and shares no code with the contracts — pauses everything, and asserts a stranger can
still deliver the card to its owner.

---

## Layout

```
app/                    Next.js 15 frontend (wagmi, SIWE, real rip flow)
scripts/devnet.mjs      One-command local stack — no Docker, no Postgres, no Redis
contracts/              Foundry — Solidity 0.8.28, OZ 5.1 upgradeable
  src/                  AccessController · CollectibleNFT · Vault · ReserveVault
                        GachaMachine · Marketplace · PaymentRouter
  test/                 149 tests: unit, fuzz, 12 invariants, cross-chain replay, offline E2E
  script/               Deploy.s.sol · chains.json · storage-layout CI gate
backend/                TypeScript · Fastify · Postgres · viem
  src/services/         signer · relayer · indexer · reconciler · poolAuthor · moonpay · compliance
tools/proof-generator/  Offline verifier. No dependencies, no network. This is the escape hatch.
docs/                   ROLE-COLLUSION.md · DEVIATIONS.md · RUNBOOKS.md
```

---

## Run it

**Nothing to install** — no Docker, no Postgres server, no Redis. Foundry and Node 20+ only.

```bash
npm install && (cd contracts && npm install) && (cd backend && npm install)
npm run devnet
```

That brings up an anvil chain, deploys the whole suite, wires every role, mints eight graded cards
into the vault, commits and activates a pool, migrates an embedded Postgres, and starts the API,
workers and frontend. Ctrl-C stops all of it.

```
Frontend    http://localhost:3000/gacha
Verifier    http://localhost:3000/tools/proof-generator/index.html
API         http://127.0.0.1:8080
Chain       http://127.0.0.1:8545  (chain id 31337)
```

Wallet connection is [Reown AppKit](https://dashboard.reown.com) (formerly WalletConnect). Set
`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` and **add every origin you serve from — including
`http://localhost:3000` — to that project's allowed domains**, or Reown answers 403 and mobile
wallets cannot connect. Injected wallets like MetaMask work either way.

### Buying a pack from your own wallet

1. **Add the network** in MetaMask: RPC `http://127.0.0.1:8545`, chain ID `31337`, symbol ETH.
   If your wallet is on any other chain the app says so and offers a switch — it will not let you
   sign for a network it does not serve.
2. **Fund your address** with test USDC and gas:
   ```bash
   cd backend && npm run devnet:fund -- 0xYourAddress
   ```
   Then add the printed USDC token address to MetaMask so you can see the balance.
3. **Open a pack.** The first purchase asks for two confirmations: an ERC-20 approval for the
   PaymentRouter, then the EIP-712 signature over the exact terms. The approval only grants an
   allowance — the amount actually charged is bounded by that second signature.

Randomness is answered automatically by a devnet daemon standing in for Chainlink (~4s, so the reveal
animation has something to show). To pick the outcome yourself:

```bash
cd backend && npm run devnet:reveal -- <vrfRequestId> 12345
```

Or skip the browser entirely — this runs the whole path and prints each step:

```bash
cd backend && npm run devnet:e2e
```

Two things are faked on the devnet and **nowhere else**: the Timelock delay is zero, and a mock VRF
coordinator stands in for Chainlink. Everything else is the production wiring — real proxies, real
role separation, real escrow, real reserve accounting, Merkle-verified settlement.

### Running the pieces individually

```bash
cd contracts && forge test                  # 149 tests
node script/check-storage-layout.mjs        # UUPS layout gate
cd backend  && npm test && npm run preflight
cd tools/proof-generator && node cli.mjs selftest
```

---

## Multi-chain

One identical deployment per chain; no shared state, no bridging. `contracts/script/chains.json` is
the registry, and it drives the deploy script, the backend and the UI.

| Chain | Gacha | Notes |
|---|---|---|
| Base, Base Sepolia | yes | Launch chain — cheap, VRF, MoonPay |
| Polygon, Arbitrum, BNB, Ethereum | yes | VRF v2.5 available |
| **Robinhood Chain** | **no — marketplace only** | No Chainlink VRF v2.5. Spec §3 forbids real-money gacha without verifiable randomness, so this deployment ships Marketplace + CollectibleNFT only. Flip `gachaEnabled` when a coordinator exists. |
| Any other EVM chain | configurable | Add an entry. `PaymentRouter` falls back to a plain allowance pull where Permit2 is absent. |

Contracts are deployed at identical addresses via a CREATE2 factory that deploys **and initializes in
one transaction**, so there is no window in which anyone could initialize a proxy first. Identical
addresses are a convenience, not a safety property — they are exactly what makes cross-chain replay
possible. What prevents it is the EIP-712 domain binding `chainId` + `verifyingContract`, gated in CI
by `CrossChainReplay.t.sol`.

**Payments:** USDC (USDT on BNB) via Permit2 or allowance, plus MoonPay on-ramp for card and Apple Pay.

---

## Admin control, stated honestly

Admins run the business day to day. Anything that can extract value or bias fairness is Timelocked.

**Instant:** pause, commit a pool (write-once, partition-verified, EV-checked on-chain), deposit
inventory, fund the reserve, set fee bps (capped in code), rotate hot keys, risk holdbacks
(duration-capped, and they never block card delivery).

**Safe multisig + 48 h Timelock:** upgrades, reserve surplus withdrawal, treasury and fee-recipient
changes, pay-token allowlist, admin role grants, emergency inventory recovery.

`docs/ROLE-COLLUSION.md` enumerates every way the system can lose value and how many independent keys
each requires. The smallest attack on user funds needs **three** separate KMS keys and is still capped
at one epoch's outflow. Three powers are deliberately single-key — pause, risk holdback, mint — each
because it must act in minutes, and each bounded in code so a compromise costs time or noise, never
user property.

---

## What is not done

`docs/DEVIATIONS.md` is the full list. The material ones:

- **No external audits yet.** The suite is audit-*ready*, not audited.
- **KMS signing and Arweave archiving are explicit boundaries, not stubs** — they throw or warn rather
  than silently degrading to an in-process key or a single pin.
- **KYC provider is an interface.** The gate is implemented and fails closed; a vendor must populate it.
- **Jurisdiction list is a placeholder.** Production refuses to boot with it empty, because counsel
  sets that list, not engineering.

### The one thing worth escalating

Paid random-outcome packs with instant cash sell-back is the fact pattern regulators look at hardest —
the buyback is what can turn "randomized retail purchase" into something a gambling or
money-transmission regime recognises. The code makes the controls real: the jurisdiction gate runs
**before payment**, on verified KYC jurisdiction rather than IP, fails closed, is logged per rip, and
self-exclusion is one-way from the user's side.

But code cannot tell you which markets to open in. Get counsel's answer per jurisdiction before
launch. Everything else here can ship on an engineering timeline; this cannot.

---

## Verification for a skeptical user

`/verify` shows live proof of reserves, the committed root and CID for every active pack, and links to
the offline tool. Nothing on that page requires trusting this backend:

```bash
# 1. Is my copy of the tool intact?
node cli.mjs selftest

# 2. Are the published odds the ones committed on-chain?
node cli.mjs verify --pool pool.json --root <root from getPoolVersion()>

# 3. Build the transaction that delivers my card, with no help from anyone.
node cli.mjs settle --pool pool.json --draw 42 --weight 87
```

---

## License

Contracts: BUSL-1.1. The offline verifier is MIT — an escape hatch nobody is allowed to copy and host
is not much of an escape hatch.

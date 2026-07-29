# Testnet multichain runbook

How to run the product across several testnets at once. This is the rehearsal for
[PRODUCTION-SETUP.md](PRODUCTION-SETUP.md), not a substitute for it — the differences are listed at
the end and they matter.

Everything here is per-chain. Adding a chain never touches another chain's state: separate
deployment, separate VRF subscription, separate reserve, separate pool. A chain that is broken or
unfunded simply is not in `ENABLED_CHAINS`.

---

## Current state

| Chain | id | Deployed | VRF | Pay token | Blocking |
|---|---|---|---|---|---|
| Base Sepolia | 84532 | **yes** | proven, weight 247 delivered | Circle USDC `0x036CbD53…dCF7e` | — |
| BNB testnet | 97 | no | subscription `472104…8300` | tUSD `0x4b3C6bdd…Ab82B` (ours) | full subscription id |
| Ethereum Sepolia | 11155111 | no | subscription `320466…7671` | Circle USDC `0x1c7D4B19…9C7238` | full subscription id · **deployer gas** |

Robinhood Chain is not on this list and cannot be: Chainlink VRF is not deployed there, so it is
marketplace-only. See its entry in `chains.json`.

### What each blocked chain needs

**BNB testnet** — the faucet pay token is deployed and in the registry. Two things remain:

- the full subscription id (the dashboard truncates it; use the copy button)
- the subscription funded in **tBNB, not LINK** — `chains.json` sets `nativePayment: true` to mirror
  the mainnet entry, so a LINK balance sits unused

**Ethereum Sepolia** — short on gas:

```
deploy    26,538,126 gas × 1.06 gwei ≈ 0.0282 ETH
balance                               0.0131 ETH
```

Roughly 0.05 ETH gives comfortable headroom, and Sepolia's gas price is volatile enough that a
tighter margin will occasionally fail mid-deploy.

---

## Per-chain deploy

Set `CHAIN_KEY` once; everything below reads it.

### 1. Register the chain

It must already exist in `contracts/script/chains.json` with `testnet: true`, a verified VRF
coordinator and key hash, and a pay token.

> Verify the key hash against <https://docs.chain.link/vrf/v2-5/supported-networks> — never by copying
> another chain's entry. A wrong key hash is accepted by our contract *and* by the coordinator's
> request call, then never fulfilled. The only symptom is a draw that hangs forever, which looks
> identical to a dead indexer or an unfunded subscription. Base Sepolia shipped with Arbitrum's hash
> for exactly this reason and it cost a live debugging session to find.

If the chain has no canonical stablecoin, deploy one rather than trusting a community token whose
minting you do not control:

```bash
cd contracts
CHAIN_KEY=<key> TOKEN_NAME="Collector Test USD" TOKEN_SYMBOL=tUSD \
  forge script script/DeployTestToken.s.sol:DeployTestToken --rpc-url "$RPC_URL" --broadcast
```

Paste the printed address into that chain's `payTokens`.

### 2. Chainlink subscription

Create at <https://vrf.chain.link>, then fund it in whichever asset `nativePayment` selects — the
native token when `true`, LINK when `false`. Funding the other one leaves requests unfulfilled with
no error anywhere except the Chainlink dashboard.

Copy the **full** subscription id with the copy button. It is a `uint256`, up to 78 digits.

### 3. Deploy

```bash
cd contracts
cp .env.deploy.example .env.deploy     # fill in CHAIN_KEY, RPC_URL, keys, subscription id
set -a && source .env.deploy && set +a
forge script script/Deploy.s.sol:Deploy --rpc-url "$RPC_URL" --broadcast
```

`TIMELOCK_DELAY_SECONDS=60` is honoured only because the chain is marked `testnet`. On any mainnet
the delay is 48 hours and no environment variable can shorten it.

Note the **lowest** `blockNumber` in
`contracts/broadcast/Deploy.s.sol/<chainId>/run-latest.json` — the seeder needs it.

### 4. Add the VRF consumer

Add the printed `gachaMachine` address as a consumer on the subscription. Nothing can request
randomness until you do. Adding it twice is harmless — Chainlink's `addConsumer` is idempotent.

### 5. Wire governance, inventory and the pool

```bash
export PAY_TOKEN=<from chains.json>
export ORACLE_ADDRESS=... RELAYER_ADDRESS=... BUYBACK_ADDRESS=...
export RESERVE_FUNDING=12000000          # 12 USDC, in token units

MODE=schedule forge script script/SetupTestnet.s.sol:SetupTestnet --rpc-url "$RPC_URL" --broadcast
# wait out the timelock delay
MODE=execute  forge script script/SetupTestnet.s.sol:SetupTestnet --rpc-url "$RPC_URL" --broadcast
MODE=activate forge script script/SetupTestnet.s.sol:SetupTestnet --rpc-url "$RPC_URL" --broadcast
```

`activate` is a separate step on purpose. `forge script` evaluates the body locally and *then*
broadcasts, so `block.number` is stale by however many blocks the broadcast takes — about 48 on Base,
against a required activation lead of 10. Computing the offset in the same run that does the setup
races the broadcast and loses.

Size the reserve deliberately: `rip` books `maxPriceRef × unavailableBps` **per open, up front**, so
a 3 USDC grail reserves 3 USDC per pack. Twelve covers four concurrent unsettled draws.

### 6. Seed the database

```bash
cd backend
CHAIN_KEY=<key> INDEXER_START_BLOCK=<deploy block - 1> RPC_URL=<rpc> npm run seed:testnet
```

`INDEXER_START_BLOCK` is mandatory and has no default. The indexer walks forward from the cursor; on
a chain tens of millions of blocks deep, a cursor at 0 is not slow, it is unreachable. The seeder
recomputes the Merkle root and refuses to write unless it matches the root the contract stored.

### 7. Enable it

Add the key to `ENABLED_CHAINS` and give it an RPC. Then `npm run testnet`.

---

## Environment

### `backend/.env`

```bash
NODE_ENV=development
DATABASE_URL=pglite://.data/testnet          # embedded; refused when NODE_ENV=production
SESSION_SECRET=<32+ bytes>

# One database serves every chain — rows are keyed by chain_id.
ENABLED_CHAINS=base_sepolia,bnb_testnet,ethereum_sepolia
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
BNB_TESTNET_RPC_URL=https://bsc-testnet-rpc.publicnode.com
ETHEREUM_SEPOLIA_RPC_URL=<Alchemy/Infura — public Sepolia endpoints stall the indexer>

# One key set across all chains. Addresses are the same everywhere, roles are granted per deployment.
SIGNER_MODE=local
ORACLE_PRIVATE_KEY=...
RELAYER_PRIVATE_KEY=...
BUYBACK_PRIVATE_KEY=...
POOL_AUTHOR_PRIVATE_KEY=...

# Permitted only while EVERY enabled chain is a testnet. config.ts refuses to start the moment a
# mainnet key appears in ENABLED_CHAINS — checked against the chain id, not against NODE_ENV.
COMPLIANCE_MODE=off
GACHA_BLOCKED_JURISDICTIONS=US-WA,US-HI,BE,NL,AU
```

> **Never use anvil's default keys on a public chain.** They are published in every Foundry tutorial
> and swept by bots within a block — the address the backend used to ship as `RELAYER_PRIVATE_KEY`
> has over 200 transactions on Base Sepolia that nobody here sent. Worse than losing test gas: those
> keys hold `TRUSTED_RELAYER_ROLE` and `PAUSE_ADMIN_ROLE`, so anyone could rip or pause. Generate
> fresh ones with `cast wallet new`.

The relayer and buyback keys **submit transactions**, so each needs native gas on every enabled
chain. The oracle and pool author only sign, and need none.

### `.env.local` (frontend)

```bash
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_DEFAULT_CHAIN_ID=84532

NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=<reown project id>

# Pin a node per chain. Without these, AppKit routes every eth_call through Reown's hosted proxy,
# which authorises by origin and answers 401 for un-whitelisted ones — surfacing as a failed
# allowance() read mid-checkout rather than as a connectivity error.
NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
NEXT_PUBLIC_BNB_RPC_URL=https://bsc-testnet-rpc.publicnode.com
NEXT_PUBLIC_ETHEREUM_RPC_URL=<Sepolia rpc>
```

Do **not** set `NEXT_PUBLIC_ANVIL_RPC_URL` — it adds the local devnet to the wallet's network list.

---

## Running

```bash
npm run testnet                          # base_sepolia
CHAIN_KEY=bnb_testnet npm run testnet
```

`scripts/testnet.mjs` refuses to start unless the chain is marked `testnet`, a deployment file
exists, `ENABLED_CHAINS` agrees, and the pool is seeded. That last check exists because an empty
`/packs` looks the same whether the database was never seeded or the chain genuinely has no pack.

The header network switcher lists what `/chains` reports, so it can only offer chains this
deployment actually serves. Chains without VRF appear as **marketplace only** rather than being
hidden — they are real places to trade, they just cannot sell a random draw.

---

## How this differs from production

Every item here is a reason this setup must not be pointed at a mainnet.

| | Testnet | Production |
|---|---|---|
| Compliance gate | `off` | `full` or `age_only` — KYC, jurisdiction, age |
| Signing keys | local env vars | AWS KMS; the process never sees a private key |
| Timelock | 60s | 48h, not overridable |
| Safe | an EOA | real multisig, sole Timelock proposer/executor |
| Database | embedded PGlite | Postgres — advisory locks are no-ops when embedded, so the indexer and reconciler stop being singletons |
| Grading certs | `TESTNET-REHEARSAL-NOT-A-REAL-CERT` | real certificate hashes bound to real graded cards |
| Reference prices | fixture, labelled as such in the API | a real price feed with recorded provenance |
| Pool file | not pinned | IPFS ×2 + Arweave |
| Audits | none | two independent, before any real money |

Run `npm run preflight` before a mainnet deploy; it must report zero blockers.

# Public testnet deployment

How to put the frontend and backend on the internet so other people can test on Base Sepolia and BNB
testnet. This is not the mainnet plan — see [PRODUCTION-SETUP.md](PRODUCTION-SETUP.md) for that, and
[TESTNET-MULTICHAIN.md](TESTNET-MULTICHAIN.md) for the per-chain contract work, which is already done.

---

## Four things that break the moment you leave localhost

Read these before choosing a host. Each one is a configuration you cannot discover by testing locally.

### 1. The embedded database will not start

`DATABASE_URL=pglite://…` is refused when `NODE_ENV=production`, deliberately: PGlite is a single
in-process connection, so the advisory locks that keep the indexer and reconciler singleton silently
become no-ops. Two instances would double-index and double-settle.

**You need managed Postgres.** Neon, Supabase, Railway and Render all have a free tier that is ample —
the whole dataset here is a few thousand rows per chain.

### 2. Session cookies die across domains

The cookie is `SameSite=Lax`, which means the browser will **not** send it on a cross-site request. So
this works:

```
app.yourdomain.com  →  api.yourdomain.com     same site, cookie sent
```

and this does not:

```
collector.vercel.app  →  collector-api.railway.app    cross-site, cookie dropped
```

The symptom is nasty: sign-in appears to succeed, then every authenticated call 401s, and it looks
like a session bug rather than a cookie-policy one.

**Use one registrable domain with two subdomains.** The alternative — `SameSite=None; Secure` — makes
the cookie third-party, which Safari's ITP and Brave block outright and Chrome is phasing out. Do not
build on it.

You need a domain for this. It is the one thing here that costs money (~$10/yr).

### 3. Reown rejects unknown origins

Its RPC proxy and WalletConnect relay authorise on project id **plus origin**. An origin that is not
on the allowlist gets a 403, which surfaces as a failed contract read mid-checkout — we hit exactly
this on localhost.

Add your deployed origin at [dashboard.reown.com](https://dashboard.reown.com) **before** you deploy,
under the project's allowed domains.

### 4. `NODE_ENV=production` demands AWS KMS — so a public testnet runs as `development`

This is the least obvious one. `NODE_ENV=production` refuses to start unless `SIGNER_MODE=kms` and all
four `KMS_*_KEY_ID`s are set. It also refuses `COMPLIANCE_MODE=off`, refuses `pglite://`, and requires
Redis and a MoonPay webhook secret.

So there are exactly two honest options, and no third:

**Option A — `NODE_ENV=development` (fastest).** Local signer keys, and you must supply the things the
production guards would otherwise have forced:

- real Postgres (the guard is off, so nothing stops you shipping PGlite — don't)
- Redis, or accept an in-memory rate limiter that resets on deploy and is per-instance
- `COMPLIANCE_MODE=age_only` by choice rather than by enforcement

**Option B — `NODE_ENV=production` + AWS KMS (the real rehearsal).** Four asymmetric secp256k1 keys,
`SIGNER_MODE=kms`, and `COMPLIANCE_MODE=age_only`. More setup, but it exercises the signing path
mainnet will use, and KMS is on the critical path for mainnet anyway. If you intend to launch, do this
once here rather than discovering it later.

Either way **set `COMPLIANCE_MODE=age_only`**, not `off`. It needs no KYC vendor, exercises the
self-attestation flow, and is the honest posture for a publicly reachable random-outcome purchase. It
also disables sell-back, removing the cash-out leg — the right trade for a public demo.

> The session cookie's `Secure` flag is keyed on `PUBLIC_ORIGIN` starting with `https://`, **not** on
> `NODE_ENV`. Otherwise Option A would have sent session cookies in plaintext on a real domain. Serve
> the API over TLS and the flag sets itself.

---

## Shape

```
app.yourdomain.com     Vercel          Next.js frontend
api.yourdomain.com     Railway/Render  Fastify API  (web process)
                       Railway/Render  workers      (separate process)
                       Neon/Supabase   Postgres
                       Upstash         Redis
```

The workers are a **separate process** (`npm run worker`), not in-process. With the embedded database
the API runs them itself; with real Postgres you want exactly one worker instance while the API scales
independently. Running workers in two API replicas means two indexers racing.

---

## Steps

### 1. Database and Redis

Create both, then run migrations once from your machine against the remote database:

```bash
cd backend
DATABASE_URL='postgres://…' npm run migrate
```

Then seed each chain. The seeder needs the deploy block so the indexer does not scan from block 1:

```bash
DATABASE_URL='postgres://…' CHAIN_KEY=base_sepolia \
  INDEXER_START_BLOCK=44777209 RPC_URL='https://base-sepolia.g.alchemy.com/v2/KEY' \
  npm run seed:testnet

DATABASE_URL='postgres://…' CHAIN_KEY=bnb_testnet \
  INDEXER_START_BLOCK=121963054 RPC_URL='https://bnb-testnet.g.alchemy.com/v2/KEY' \
  npm run seed:testnet
```

The v2 pools are already committed on both chains, so `pool:commit` is **not** needed — but it does
write the leaves the settlement proofs are built from, and the seeder only writes v1's. Re-run it
against the remote database with the same file, and it will skip the on-chain work and seed only:

```bash
DATABASE_URL='postgres://…' RPC_URL='…' DEPLOYER_PRIVATE_KEY=0x… \
  npm run pool:commit -- --file pools/elite-1m.json --chain base_sepolia --version 2
```

> It detects the finalized pool, verifies the root against the chain, and writes the leaves. Without
> this step settlement fails with `BadMerkleProof` — the proofs come from the database, not the chain.

### 2. Backend

Deploy `backend/` twice from the same repo — once as the API, once as the workers.

```bash
# API process
npm ci && npm run build && node dist/index.js     # or: npm run dev:all
# worker process
npm ci && npm run build && node dist/workers/index.js
```

`backend/.env` for both:

```bash
# Option A. See blocker 4 — `production` would require KMS. The Secure cookie flag comes from
# PUBLIC_ORIGIN being https, so this does not weaken the session.
NODE_ENV=development
PORT=8080
PUBLIC_ORIGIN=https://app.yourdomain.com        # exact origin; CORS allows only this

DATABASE_URL=postgres://…                        # NOT pglite — nothing enforces this here
REDIS_URL=rediss://…                             # without it, rate limits are per-instance and reset
SESSION_SECRET=<32+ random bytes>

ENABLED_CHAINS=base_sepolia,bnb_testnet
BASE_SEPOLIA_RPC_URL=https://base-sepolia.g.alchemy.com/v2/BACKEND_KEY
BNB_TESTNET_RPC_URL=https://bnb-testnet.g.alchemy.com/v2/BACKEND_KEY

# These four keys hold TRUSTED_RELAYER / ORACLE / BUYBACK and PAUSE_ADMIN. Whoever holds the relayer
# key can rip and pause. Generate fresh ones per deployment; never reuse a devnet key.
SIGNER_MODE=local
ORACLE_PRIVATE_KEY=0x…
RELAYER_PRIVATE_KEY=0x…
BUYBACK_PRIVATE_KEY=0x…
POOL_AUTHOR_PRIVATE_KEY=0x…

COMPLIANCE_MODE=age_only
GACHA_BLOCKED_JURISDICTIONS=US-WA,US-HI,BE,NL,AU
MIN_AGE_YEARS=18

INDEXER_INTERVAL_MS=12000
RECONCILER_AUTOPAUSE=true
ALERT_WEBHOOK_URL=<Slack/Discord webhook>
```

For Option B, swap the four private keys for `SIGNER_MODE=kms` plus `KMS_ORACLE_KEY_ID`,
`KMS_RELAYER_KEY_ID`, `KMS_BUYBACK_KEY_ID`, `KMS_POOL_AUTHOR_KEY_ID`, set `NODE_ENV=production`, and add
`MOONPAY_WEBHOOK_SECRET` — the production guard requires it even though nothing on testnet uses it.

Point `api.yourdomain.com` at this service and make sure TLS is on — the cookie sets `Secure` in
production and will not be stored over plain HTTP.

### 3. Frontend

Vercel, root of the repo. `.env.local` equivalents as Vercel environment variables:

```bash
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
NEXT_PUBLIC_DEFAULT_CHAIN_ID=84532
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=<reown project id>

# A SEPARATE Alchemy key from the backend's. These ship in the browser bundle, so anyone can read
# and reuse them — a shared key lets a scraper exhaust the quota the indexer depends on.
NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL=https://base-sepolia.g.alchemy.com/v2/FRONTEND_KEY
NEXT_PUBLIC_BNB_TESTNET_RPC_URL=https://bnb-testnet.g.alchemy.com/v2/FRONTEND_KEY
```

Do **not** set `NEXT_PUBLIC_ANVIL_RPC_URL` — it adds the local devnet to the wallet's network list.

Add a domain allowlist to the frontend Alchemy key in their dashboard.

### 4. Fund the hot keys

The relayer and buyback keys **submit transactions**, so each needs native gas on every enabled chain.
Nothing works without this and the failure is a hang, not an error:

```bash
# per chain, per key
cast send <relayer> --value 0.05ether --private-key $DEPLOYER_PRIVATE_KEY --rpc-url <rpc>
cast send <buyback> --value 0.05ether --private-key $DEPLOYER_PRIVATE_KEY --rpc-url <rpc>
```

Base Sepolia at 0.006 gwei makes 0.05 ETH effectively unlimited. BNB testnet sits at 1 gwei — twenty
times BNB mainnet — so budget more there and expect to top up.

---

## Verify before sharing the link

```bash
curl https://api.yourdomain.com/health
curl https://api.yourdomain.com/chains    # two chains, faucet present on both
curl https://api.yourdomain.com/packs     # v2, 989 cards, $300, cUSD
curl https://api.yourdomain.com/reserves  # solvent true, buybackPaused false
```

Then in a browser, from a wallet that has never touched this deployment:

1. connect → the network dropdown lists both chains with logos
2. **Sign in** — proves the cookie survived the domain split, the single most likely thing to be broken
3. **Get 2,000 cUSD** — proves the faucet and the frontend RPC
4. confirm age → **Open Pack** → a real Chainlink VRF reveal in ~10s
5. **Keep it** → the card appears under Marketplace → My cards
6. list it, then buy it from a second wallet

If step 2 fails but everything else works, it is the cookie: check that both hosts are subdomains of
one registrable domain and that the API is on HTTPS.

---

## What to watch once it is public

| | Why | Where |
|---|---|---|
| **Relayer gas** | at zero, every rip hangs with no user-facing error | `ALERT_WEBHOOK_URL`; check balances daily |
| **`vrf_stuck_draws`** | VRF subscription empty, or a wrong key hash | alert fires per reconciler pass |
| **VRF subscription balance** | Base 30 gwei lane reserves ~0.006 ETH/request | vrf.chain.link |
| **`reserve_divergence`** | should never fire; it auto-pauses buyback | alert |
| **Alchemy quota** | free tier is 300M CU/month; the indexer is the biggest consumer | Alchemy dashboard |

---

## Be straight with your testers

Put this on the page or in the invite. Some of it is already in the UI; the rest is not.

- **cUSD is play money and the supply is unlimited.** The token's `mint()` is public, so anyone can take
  any amount — the faucet button dispenses 2,000 (about six packs) and can be pressed repeatedly. The
  reserve is funded from the same tap, so its solvency proof demonstrates the mechanism and says nothing
  about backing.
- **The cards are not real.** Grading commitments are literally
  `TESTNET-NOT-A-REAL-CERT-…`, and reference prices are labelled
  `testnet rehearsal fixture (NOT a real price feed)` in the API.
- **`age_only` means no sell-back.** Keep, redeem and peer-to-peer trade work; cashing out to the
  reserve does not. That is a deliberate consequence of running without KYC.
- **Testnets get reset.** Base Sepolia and BNB testnet can be wiped by their operators; anything held
  here can vanish.

## Still not production

Beyond everything above: signing keys are local env vars rather than KMS, the Safe is an EOA, the
Timelock is 60 seconds rather than 48 hours, pool files are not pinned to IPFS or Arweave, and there
have been no audits. `npm run preflight` enumerates the full list and must report zero blockers before
a mainnet deploy.

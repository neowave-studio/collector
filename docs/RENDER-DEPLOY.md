# Deploying to Render

Everything on Render, no custom domain, `NODE_ENV=development` with local signer keys. This is
Option A of [TESTNET-PUBLIC-DEPLOY.md](TESTNET-PUBLIC-DEPLOY.md) — read that first if you want the
reasoning; this is just the Render-specific execution of it.

`render.yaml` in the repo root is the blueprint. It creates five things:

```
collector-web        web      Next.js frontend + same-origin /api proxy
collector-api        web      Fastify API
collector-workers    worker   indexer + reconciler, exactly one instance
collector-db         pg       Postgres
collector-redis      keyvalue Redis
```

---

## The Render-specific trap: your session cookie will be dropped

`onrender.com` is on the [Public Suffix List](https://publicsuffix.org/list/). That means
`collector-web.onrender.com` and `collector-api.onrender.com` are not two subdomains of one site —
they are two **separate registrable domains**, and requests between them are cross-site.

The session cookie is `SameSite=Lax` (`backend/src/services/auth.ts:113`) and the frontend calls with
`credentials: "include"` (`app/lib/api.js:16`). Cross-site, the browser never sends it. SIWE sign-in
appears to succeed and then every authenticated call 401s — it reads like a session bug, and it is a
cookie-policy one. Default Render hostnames walk straight into this.

The fix here is a rewrite in `next.config.mjs`: the browser only ever talks to `collector-web`, which
proxies `/api/*` to the API over Render's private network. Same origin, first-party cookie, no domain
purchase. `SameSite=None; Secure` is the other way out and is not worth building on — Safari's ITP
and Brave block third-party cookies outright.

The alternative, if you do own a domain, is `app.example.com` + `api.example.com`; then drop
`BACKEND_INTERNAL_URL`, point `NEXT_PUBLIC_API_URL` at the API's full URL, and the proxy is unused.

---

## 1. Before you touch Render

**Reown.** Add `https://collector-web.onrender.com` to your project's allowed domains at
[dashboard.reown.com](https://dashboard.reown.com). Reown authorises on project id *plus* origin; an
unlisted origin gets a 403 that surfaces as a failed contract read mid-checkout, not as an auth
error. You will not know the exact hostname until after the first apply, so expect to come back —
or claim the name first by creating the blueprint, then filling this in.

**Alchemy.** Two separate keys — one for the backend, one for the frontend. The frontend's ships in
the browser bundle where anyone can read and reuse it, and a shared key lets a scraper exhaust the
quota the indexer depends on. Add a domain allowlist to the frontend key.

**Signer keys.** Generate four fresh ones. `cast wallet new` four times, or any secp256k1 keygen.
Do not reuse the keys in `backend/.env.example` — they are published in this repo.

```
ORACLE_PRIVATE_KEY        signs rip terms
RELAYER_PRIVATE_KEY       submits transactions, holds TRUSTED_RELAYER + PAUSE_ADMIN
BUYBACK_PRIVATE_KEY       submits buyback transactions
POOL_AUTHOR_PRIVATE_KEY   commits pools
```

Whoever holds the relayer key can rip and pause. On Render these are environment variables, which is
exactly why this is not a mainnet posture.

## 2. Apply the blueprint

Push the branch, then in Render: **New → Blueprint**, pick the repo. It reads `render.yaml` and shows
every service plus the variables marked `sync: false` for you to fill.

Fill the backend ones (they live in the `collector-backend` env var group, so you enter them once and
both the API and the workers get them):

```
ORACLE_PRIVATE_KEY, RELAYER_PRIVATE_KEY, BUYBACK_PRIVATE_KEY, POOL_AUTHOR_PRIVATE_KEY
BASE_SEPOLIA_RPC_URL      https://base-sepolia.g.alchemy.com/v2/BACKEND_KEY
BNB_TESTNET_RPC_URL       https://bnb-testnet.g.alchemy.com/v2/BACKEND_KEY
ALERT_WEBHOOK_URL         Slack/Discord webhook
```

and the frontend ones:

```
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL     https://base-sepolia.g.alchemy.com/v2/FRONTEND_KEY
NEXT_PUBLIC_BNB_TESTNET_RPC_URL      https://bnb-testnet.g.alchemy.com/v2/FRONTEND_KEY
```

`PUBLIC_ORIGIN` is left blank on purpose — see step 4.

> **`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is required to *build*, not just to run.**
> `app/providers/Web3Provider.js:11` only calls `createAppKit` when the project id is present, and
> `/how-it-works` calls `useAppKit` during prerender. With the variable unset the build dies with
> `Error: Please call "createAppKit" before using "useAppKit" hook` on that page — which reads like
> a React bug and is really a missing environment variable. Set it before the first deploy.

## 3. Migrate and seed, from your machine

The database is empty and nothing migrates it on boot. Grab the **External** connection string from
the `collector-db` dashboard (the internal one is unreachable from your laptop) and run:

```bash
cd backend
export DATABASE_URL='postgres://…?sslmode=require'   # external URL, TLS required

npm run migrate

npm run seed:testnet   # per chain — the deploy block keeps the indexer from scanning from block 1
# CHAIN_KEY=base_sepolia INDEXER_START_BLOCK=44777209 RPC_URL='https://base-sepolia.g.alchemy.com/v2/KEY'
# CHAIN_KEY=bnb_testnet  INDEXER_START_BLOCK=121963054 RPC_URL='https://bnb-testnet.g.alchemy.com/v2/KEY'
```

`backend/src/db/index.ts` builds the pool with no explicit `ssl` option, so the `sslmode=require` in
the URL is what turns TLS on. If the driver still rejects Render's certificate, `sslmode=no-verify`
is the escape hatch for this one-off admin connection.

Then write the settlement leaves. The v2 pools are already committed on both chains, but the seeder
only writes v1's leaves, and **settlement proofs are built from the database, not the chain** —
without this, every settle fails with `BadMerkleProof`:

```bash
DATABASE_URL='postgres://…' RPC_URL='…' DEPLOYER_PRIVATE_KEY=0x… \
  npm run pool:commit -- --file pools/elite-1m.json --chain base_sepolia --version 2
```

It detects the finalized pool, verifies the root against the chain, and seeds only the leaves.

## 4. Close the loop on PUBLIC_ORIGIN

Render has now assigned hostnames. Set `PUBLIC_ORIGIN` on **both** `collector-api` and
`collector-workers` to the **frontend's** URL — not the API's:

```
PUBLIC_ORIGIN=https://collector-web.onrender.com
```

That is the origin the browser actually presents, so it is what CORS must allow. It also drives the
session cookie's `Secure` flag, which is keyed on `PUBLIC_ORIGIN` starting with `https://` rather
than on `NODE_ENV` — which is precisely why `NODE_ENV=development` here does not ship a plaintext
cookie. Redeploy both services.

## 5. Fund the hot keys

The relayer and buyback keys submit transactions and need native gas **on every enabled chain**.
Without it nothing works, and the failure mode is a hang, not an error:

```bash
cast send <relayer> --value 0.05ether --private-key $DEPLOYER_PRIVATE_KEY --rpc-url <rpc>
cast send <buyback> --value 0.05ether --private-key $DEPLOYER_PRIVATE_KEY --rpc-url <rpc>
```

Base Sepolia at 0.006 gwei makes 0.05 ETH effectively unlimited. BNB testnet sits at 1 gwei — twenty
times BNB mainnet — so budget more there and expect to top up.

---

## Verify before sharing the link

Everything goes through the proxy, which is itself the thing most likely to be misconfigured:

```bash
curl https://collector-web.onrender.com/api/health     # {"ok":true}
curl https://collector-web.onrender.com/api/chains     # two chains, faucet present on both
curl https://collector-web.onrender.com/api/packs      # v2, 989 cards, $300, cUSD
curl https://collector-web.onrender.com/api/reserves   # solvent true, buybackPaused false
```

Then in a browser, from a wallet that has never touched this deployment:

1. connect → the network dropdown lists both chains
2. **Sign in** — this is the cookie test, and the single most likely thing to be broken
3. **Get 2,000 cUSD** → confirm age → **Open Pack** → a real Chainlink VRF reveal in ~10s
4. **Keep it** → the card appears under Marketplace → My cards → list it → buy it from a second wallet

If step 2 fails and everything else works, it is still the cookie. Check `NEXT_PUBLIC_API_URL=/api`,
that `BACKEND_INTERNAL_URL` resolved, and that `PUBLIC_ORIGIN` is the **web** URL.

---

## Render-specific caveats

**Free web services spin down after ~15 minutes idle** and cold-start on the next request. For the
frontend that is a slow first load. It is why the workers are a paid background worker rather than
`RUN_WORKERS_IN_PROCESS=true` on a free API — a spun-down indexer is not indexing, and the
reconciler is what catches stuck VRF draws and reserve divergence.

**Free Postgres expires 30 days after creation.** Render deletes it. Upgrade before then or plan to
re-run step 3.

**Never scale `collector-workers` past one instance.** Two indexers race, double-index and
double-settle. The Postgres advisory locks that make them singleton are the reason PGlite is refused
in production at all.

**Private networking may not cover free instance types.** If `BACKEND_INTERNAL_URL` will not resolve,
set it to the API's public URL (`https://collector-api.onrender.com`) instead. The cookie fix does
not depend on the private network — only on the browser seeing one origin.

## Still not production

Signing keys are environment variables rather than KMS, the Safe is an EOA, the Timelock is 60
seconds rather than 48 hours, pool files are not pinned to IPFS or Arweave, and nothing has been
audited. `npm run preflight` enumerates the full list and must report zero blockers before a mainnet
deploy. Tell your testers what `docs/TESTNET-PUBLIC-DEPLOY.md` says to tell them — cUSD is play
money with a public `mint()`, the cards are not real, and `age_only` means no sell-back.

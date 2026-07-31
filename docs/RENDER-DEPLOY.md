# Deploying to Render

Everything on Render, no custom domain, `NODE_ENV=development` with local signer keys. This is
Option A of [TESTNET-PUBLIC-DEPLOY.md](TESTNET-PUBLIC-DEPLOY.md) — read that first if you want the
reasoning; this is just the Render-specific execution of it.

`render.yaml` in the repo root is the blueprint. It creates three things, all on free plans:

```
collector-web        web  Next.js frontend + same-origin /api proxy
collector-api        web  Fastify API + indexer + reconciler, in one process
collector-db         pg   Postgres
```

There is no Key Value instance and no separate worker service. Render allows one free Key Value per
workspace and `soleai-redis` already holds that slot, so a free one here cannot be created at all —
the apply halts on it, which is exactly what happened on the first attempt. And Render has no free
worker tier. Both are annotated in `render.yaml` where they used to be, with how to restore them.

Neither omission is a bodge. Without `REDIS_URL` the backend falls back to an in-process rate
limiter (`config.ts` defaults it to `''`); the guard that refuses that only fires under
`NODE_ENV=production`. Per-instance limiting costs nothing when the plan runs one instance anyway.
The workers move in-process via `RUN_WORKERS_IN_PROCESS`, which `src/index.ts:150` honours — safe
only at one instance, and the free plan cannot exceed one. **If you move `collector-api` to a paid
plan, split the workers back out first**: two indexers race, double-index and double-settle.

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

**Signer keys — do NOT generate fresh ones.** The contracts are already deployed on both testnets and
the roles are already granted on-chain, to these addresses (verified live on Base Sepolia *and* BNB
testnet — they match on both):

```
ORACLE_PRIVATE_KEY        0xCAced5C126B88c6c05bE7D753b3eAB96Ca4470d3   TRUSTED_ORACLE
RELAYER_PRIVATE_KEY       0x5248B552E2D9e4533cAe68Cd4377be24430BE6AA   TRUSTED_RELAYER
BUYBACK_PRIVATE_KEY       0x1FCf31eF9d4dc8CC2E0c38c836fDc2235651a491   TRUSTED_BUYBACK
POOL_AUTHOR_PRIVATE_KEY   0xC1725953BE260ECd5c5CA21eb5524D4986aFD06F   POOL_AUTHOR + OPERATIONS
```

You must supply the private keys **for exactly these addresses**. A freshly generated key holds no
role, and `RoleGated` live-reads the AccessController with nothing cached — so every `rip`, `settle`
and `commitPool` reverts. The failure is not a config error at boot; it is a revert on the first
purchase, which is a far worse place to discover it.

If you genuinely need to rotate to new keys, grant the roles first. `TRUSTED_*` grants are ops
authority rather than governance, so they are instant and need no Timelock — but they must be sent
from the `OPERATIONS_ROLE` holder above, on *each* chain:

```bash
MODE=execute RELAYER_ADDRESS=0x… ORACLE_ADDRESS=0x… BUYBACK_ADDRESS=0x… \
  forge script script/SetupTestnet.s.sol --rpc-url <rpc> --broadcast
```

`POOL_AUTHOR_ROLE` is *not* instant — it goes through the Timelock with the rest of the ops batch.

The keys in `backend/.env.example` are published in this repo and hold none of these roles. One
exception worth knowing: its relayer address `0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc` **does**
hold `PAUSE_ADMIN_ROLE` on Base Sepolia, left over from setup. Anyone reading this repo can therefore
pause the Base Sepolia deployment. Harmless on a testnet, unacceptable on anything else — revoke it
before this shape of deployment goes anywhere real.

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
# CHAIN_KEY=base_sepolia     INDEXER_START_BLOCK=44777231  RPC_URL='https://base-sepolia.g.alchemy.com/v2/KEY'
# CHAIN_KEY=bnb_testnet      INDEXER_START_BLOCK=121963176 RPC_URL='https://bnb-testnet.g.alchemy.com/v2/KEY'
# CHAIN_KEY=ethereum_sepolia INDEXER_START_BLOCK=11375582  RPC_URL='https://eth-sepolia.g.alchemy.com/v2/KEY'
```

**Do not skip this, and do not guess the numbers.** `chains.last_indexed_block` defaults to 0, and
`indexChain` starts at `last_indexed_block + 1` and loops to the chain head *within a single call*
(`services/indexer.ts:49`). A fresh database therefore scans every chain from block 1 — on the first
real deploy that meant BNB testnet grinding through 74 million blocks of `eth_getLogs`, burning the
Alchemy quota the indexer itself depends on, and it does it while holding the advisory lock.

The blocks above are the ones where `gachaMachine` first has code, found by binary search on
`eth_getCode` rather than copied from a deploy log — the two values previously written here were
both wrong, by 22 and 122 blocks. To re-derive them for a new deployment, binary search
`getCode(gachaMachine)` between 0 and head.

If you need to correct a running deployment, note that the indexer holds `from` in memory and writes
it back after every batch, so a plain `UPDATE` is immediately clobbered. Restart the service first,
then write the cursor while it is down. Only ever move a cursor **forward**, and never past a
contract's deploy block — rewinding re-indexes settled events.

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

## 4. Tidy up PUBLIC_ORIGIN

`render.yaml` ships `PUBLIC_ORIGIN=https://collector-web.onrender.com` as a literal so the API boots
on the first apply — it used to be blank, which made the first deploy fail by construction, because
`config.ts` requires a valid URL.

It must be the **real** `collector-web` origin, exactly. Render suffixes names that are already
taken globally, which is why the live deployment is `collector-web-i3nj.onrender.com` and not
`collector-web.onrender.com`. Three things read this value:

- The session cookie's `Secure` flag, keyed on `PUBLIC_ORIGIN` starting with `https://` rather than
  on `NODE_ENV` — which is precisely why `NODE_ENV=development` here does not ship a plaintext
  cookie. Any https value satisfies this one.
- The CORS allowlist, which the browser never exercises under the proxy — it calls `collector-web`'s
  own origin and Next forwards server-side, and same-origin requests are not CORS-checked.
- **SIWE verification.** `/auth/nonce` hands the wallet `new URL(PUBLIC_ORIGIN).host` to sign over,
  and `/auth/verify` passes `PUBLIC_ORIGIN` as the expected origin (`routes/auth.ts:18,26`).

That third one is why a wrong hostname is not a cosmetic problem. It does not degrade anything —
sign-in fails outright while every unauthenticated endpoint keeps working, which reads like a wallet
bug rather than a config one. Check it with:

```bash
curl -s https://<web-host>/api/auth/nonce   # "domain" must equal <web-host>
```

An `http://` value is separately fatal: it silently disables `Secure`.

## 5. Fund the hot keys

Balances as measured against the live role holders:

```
                    base_sepolia            bnb_testnet
relayer             0.00397 ETH   low       0.01670 BNB   ok
oracle              0             fine      0             fine
buyback             0             see below 0             see below
pool author         0.01981 ETH   ok        0.26932 BNB   ok
```

**The oracle never needs gas.** It is an EIP-712 signer — it signs rip and buyback terms off-chain
and the relayer pays to submit them. A zero balance there is correct, not a gap.

**The buyback key needs no gas under this config either.** `COMPLIANCE_MODE=age_only` refuses the
sell-back path outright (`backend/src/services/compliance.ts:191`), so `settleBuyback` is never
called. Fund it only if you move to `full`.

**The relayer is the one to watch,** and Base Sepolia is on the low side of the 0.05 ETH below. At
0.006 gwei it still covers a great many rips, so it is not a blocker for a first deploy — but it is
the account that empties, and when it does every rip hangs with no user-facing error.

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
frontend that is a slow first load. For `collector-api` it also means the in-process indexer stops
while the service sleeps — it resumes and catches up on the next request rather than losing
anything, but the reconciler is what catches stuck VRF draws and reserve divergence, so it is not
watching during that window. Splitting the workers back onto a paid `type: worker` service is the
fix when that matters.

**Free Postgres expires 30 days after creation.** Render deletes it. Upgrade before then or plan to
re-run step 3.

**Never run more than one instance of whatever hosts the workers.** Today that is `collector-api`,
via `RUN_WORKERS_IN_PROCESS` — the free plan pins it to one, so moving that service to a paid plan
is the moment this stops being enforced for you. Two indexers race, double-index and
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

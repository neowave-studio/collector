-- =============================================================================================
-- Collector schema (spec §8.3)
--
-- TRUST BOUNDARY (spec §2, FIX C3-backend): for anything involving money or NFT ownership the CHAIN
-- is authoritative and these tables are a CACHE. Every column below that mirrors chain state carries
-- the block it was observed at, so the reconciler can rebuild it from events alone and detect drift.
-- The only tables that are genuinely source-of-truth are the off-chain ones: kyc, shipments,
-- moonpay_orders, audit_log.
-- =============================================================================================

-- No extensions required. Ids are application-generated (session ids, nonces) or BIGSERIAL,
-- which keeps the schema portable across managed Postgres and the embedded dev database.

-- --- chains ----------------------------------------------------------------------------------
CREATE TABLE chains (
  chain_id          BIGINT PRIMARY KEY,
  chain_key         TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  gacha_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  vrf_coordinator   TEXT,
  confirmations     INT NOT NULL,
  last_indexed_block BIGINT NOT NULL DEFAULT 0,
  buyback_paused    BOOLEAN NOT NULL DEFAULT FALSE,
  buyback_paused_reason TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --- packs & pools ---------------------------------------------------------------------------
CREATE TABLE packs (
  chain_id            BIGINT NOT NULL REFERENCES chains(chain_id),
  pack_id             TEXT NOT NULL,                 -- bytes32 hex
  name                TEXT NOT NULL,
  image_url           TEXT,
  active_pool_version NUMERIC(78,0),
  active_from_block   BIGINT,
  PRIMARY KEY (chain_id, pack_id)
);

CREATE TABLE pool_versions (
  chain_id        BIGINT  NOT NULL,
  pack_id         TEXT    NOT NULL,
  version         NUMERIC(78,0) NOT NULL,
  merkle_root     TEXT    NOT NULL,
  total_weight    NUMERIC(78,0) NOT NULL,
  card_count      INT     NOT NULL,
  price_per_rip   NUMERIC(78,0) NOT NULL,
  pay_token       TEXT    NOT NULL,
  buyback_bps     INT     NOT NULL,
  unavailable_bps INT     NOT NULL,
  house_margin_bps INT    NOT NULL,
  reserve_bps     INT     NOT NULL,
  max_reserve_per_rip NUMERIC(78,0) NOT NULL,
  -- On-chain pinned CID of the published pool file. This is what makes the file tamper-evident and
  -- what the offline proof tool consumes (spec §8.2 FIX C1-backend).
  pool_cid        TEXT    NOT NULL,
  ipfs_pins       TEXT[]  NOT NULL DEFAULT '{}',
  arweave_tx      TEXT,
  -- Provenance for every priceRef in this version (spec §5.4 FIX M2-fair): feed source + snapshot ts.
  price_ref_source TEXT   NOT NULL,
  price_ref_snapshot_at TIMESTAMPTZ NOT NULL,
  committed_tx    TEXT    NOT NULL,
  committed_block BIGINT  NOT NULL,
  PRIMARY KEY (chain_id, pack_id, version),
  FOREIGN KEY (chain_id, pack_id) REFERENCES packs(chain_id, pack_id)
);

CREATE TABLE pool_leaves (
  chain_id   BIGINT NOT NULL,
  pack_id    TEXT   NOT NULL,
  version    NUMERIC(78,0) NOT NULL,
  leaf_index INT    NOT NULL,
  token_id   NUMERIC(78,0) NOT NULL,
  cum_before NUMERIC(78,0) NOT NULL,
  weight     NUMERIC(78,0) NOT NULL,
  price_ref  NUMERIC(78,0) NOT NULL,
  leaf_hash  TEXT   NOT NULL,
  PRIMARY KEY (chain_id, pack_id, version, leaf_index),
  FOREIGN KEY (chain_id, pack_id, version) REFERENCES pool_versions(chain_id, pack_id, version)
);
CREATE INDEX pool_leaves_weight_lookup ON pool_leaves (chain_id, pack_id, version, cum_before);

-- --- draws -----------------------------------------------------------------------------------
CREATE TYPE draw_status AS ENUM ('requested', 'revealed', 'delivered', 'bought_back', 'compensated', 'refunded');

CREATE TABLE draws (
  chain_id        BIGINT NOT NULL REFERENCES chains(chain_id),
  draw_id         NUMERIC(78,0) NOT NULL,
  user_address    TEXT   NOT NULL,
  pack_id         TEXT   NOT NULL,
  pool_version    NUMERIC(78,0) NOT NULL,
  vrf_request_id  NUMERIC(78,0),
  winning_weight  NUMERIC(78,0),
  reserved_amount NUMERIC(78,0) NOT NULL,
  escrow          NUMERIC(78,0) NOT NULL,
  status          draw_status NOT NULL DEFAULT 'requested',
  requested_block BIGINT NOT NULL,
  revealed_at     TIMESTAMPTZ,
  -- Jurisdiction decision recorded per rip (spec §12): what was checked, and what it decided.
  jurisdiction    TEXT,
  age_verified    BOOLEAN NOT NULL DEFAULT FALSE,
  fiat_funded     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, draw_id)
);
CREATE INDEX draws_user ON draws (user_address, created_at DESC);
CREATE INDEX draws_open ON draws (chain_id, status) WHERE status IN ('requested', 'revealed');

CREATE TABLE settlements (
  chain_id   BIGINT NOT NULL,
  draw_id    NUMERIC(78,0) NOT NULL,
  kind       TEXT   NOT NULL CHECK (kind IN ('deliver', 'timeout', 'buyback', 'compensate', 'refund')),
  token_id   NUMERIC(78,0),
  payout     NUMERIC(78,0),
  tx_hash    TEXT   NOT NULL,
  block      BIGINT NOT NULL,
  settled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, draw_id),
  FOREIGN KEY (chain_id, draw_id) REFERENCES draws(chain_id, draw_id)
);

-- --- reserve ---------------------------------------------------------------------------------
-- CACHE ONLY. Fully rebuildable from Reserved/Unreserved/Paid/Funded events; the reconciler compares
-- it against the chain every RECONCILER_INTERVAL_MS and auto-pauses buyback on divergence (§8.3).
CREATE TABLE reserve_ledger (
  chain_id         BIGINT NOT NULL REFERENCES chains(chain_id),
  token            TEXT   NOT NULL,
  reserved         NUMERIC(78,0) NOT NULL DEFAULT 0,
  paid             NUMERIC(78,0) NOT NULL DEFAULT 0,
  funded           NUMERIC(78,0) NOT NULL DEFAULT 0,
  balance_snapshot NUMERIC(78,0) NOT NULL DEFAULT 0,
  synced_block     BIGINT NOT NULL DEFAULT 0,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, token)
);

CREATE TABLE reconciliation_events (
  id          BIGSERIAL PRIMARY KEY,
  chain_id    BIGINT NOT NULL,
  token       TEXT   NOT NULL,
  chain_value NUMERIC(78,0) NOT NULL,
  db_value    NUMERIC(78,0) NOT NULL,
  action      TEXT   NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --- inventory -------------------------------------------------------------------------------
CREATE TABLE nfts (
  chain_id     BIGINT NOT NULL REFERENCES chains(chain_id),
  token_id     NUMERIC(78,0) NOT NULL,
  cert_number  TEXT NOT NULL,
  grade        TEXT NOT NULL,
  grading_co   TEXT NOT NULL,
  scan_hash    TEXT NOT NULL,
  commitment   TEXT NOT NULL,
  name         TEXT,
  set_name     TEXT,
  year         INT,
  image_url    TEXT,
  location     TEXT NOT NULL CHECK (location IN ('vault', 'user', 'redeemed')) DEFAULT 'vault',
  pack_id      TEXT,
  owner        TEXT,
  synced_block BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (chain_id, token_id),
  UNIQUE (chain_id, commitment)
);

CREATE TABLE shipments (
  chain_id    BIGINT NOT NULL,
  token_id    NUMERIC(78,0) NOT NULL,
  -- Idempotent on tokenId and driven ONLY by the RedeemRequested event (spec §5.1 FIX H7-backend).
  redeem_tx   TEXT NOT NULL,
  recipient   TEXT NOT NULL,
  address_ref TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
  carrier     TEXT,
  tracking    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, token_id)
);

-- --- fiat ------------------------------------------------------------------------------------
CREATE TABLE moonpay_orders (
  order_id        TEXT PRIMARY KEY,
  user_address    TEXT NOT NULL,
  chain_id        BIGINT,
  fiat_amount     NUMERIC(20,2),
  fiat_currency   TEXT,
  crypto_amount   NUMERIC(78,0),
  crypto_currency TEXT,
  -- MoonPay's own status. NEVER treated as proof of funds on its own (spec §9 FIX M5-backend):
  -- `onchain_confirmed_tx` must be set before anything is delivered.
  status          TEXT NOT NULL,
  chargeback_state TEXT NOT NULL DEFAULT 'none'
    CHECK (chargeback_state IN ('none', 'disputed', 'charged_back', 'reversed')),
  onchain_confirmed_tx TEXT,
  onchain_confirmed_at TIMESTAMPTZ,
  holdback_until  TIMESTAMPTZ,
  linked_action   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX moonpay_orders_user ON moonpay_orders (user_address);

CREATE TABLE moonpay_webhook_events (
  event_id     TEXT PRIMARY KEY,
  order_id     TEXT,
  type         TEXT NOT NULL,
  payload      JSONB NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --- identity & compliance -------------------------------------------------------------------
CREATE TABLE kyc (
  user_address     TEXT PRIMARY KEY,
  provider_ref     TEXT,
  status           TEXT NOT NULL DEFAULT 'none'
    CHECK (status IN ('none', 'pending', 'approved', 'rejected')),
  jurisdiction     TEXT,
  age_verified     BOOLEAN NOT NULL DEFAULT FALSE,
  fiat_cashout_tier INT NOT NULL DEFAULT 0,
  self_excluded_until TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE siwe_nonces (
  nonce      TEXT PRIMARY KEY,
  issued_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed   BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  user_address  TEXT NOT NULL,
  chain_id      BIGINT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ
);
CREATE INDEX sessions_user ON sessions (user_address);

-- --- money-action idempotency ----------------------------------------------------------------
-- Durable (Postgres, not Redis) and reorg-aware (spec §8.4 FIX C3/M7-backend). A key only becomes
-- terminal at `confirmations` depth; a reorg below that depth resets it to resubmittable.
CREATE TABLE idempotency_keys (
  key            TEXT PRIMARY KEY,
  chain_id       BIGINT NOT NULL,
  kind           TEXT NOT NULL,
  state          TEXT NOT NULL CHECK (state IN ('in_flight', 'submitted', 'confirmed', 'failed')),
  tx_hash        TEXT,
  observed_block BIGINT,
  result         JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idempotency_pending ON idempotency_keys (state) WHERE state IN ('in_flight', 'submitted');

-- --- audit -----------------------------------------------------------------------------------
-- Shipped continuously to a separate WORM store (cross-account S3 Object Lock) so it stays
-- tamper-evident even against a database administrator (spec §8.6 FIX M2-backend).
CREATE TABLE audit_log (
  id         BIGSERIAL PRIMARY KEY,
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  target     TEXT,
  before_val JSONB,
  after_val  JSONB,
  ip         INET,
  ts         TIMESTAMPTZ NOT NULL DEFAULT now(),
  exported   BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX audit_log_unexported ON audit_log (id) WHERE NOT exported;

-- =============================================================================================
-- Marketplace order book (spec §5.6)
--
-- Orders are signed off-chain and filled on-chain. This table is ONLY a convenience index so buyers
-- can discover them — it holds no authority whatsoever. The signature is what authorises a fill, and
-- `Marketplace.sol` re-verifies it, checks the expiry and consumes the maker's nonce. A corrupted or
-- hostile row here produces a reverted transaction, never a bad trade.
--
-- That is why there is no "price" the backend can tamper with: the price is inside the signed payload.
-- =============================================================================================

CREATE TABLE listings (
  id            BIGSERIAL PRIMARY KEY,
  chain_id      BIGINT NOT NULL REFERENCES chains(chain_id),
  kind          TEXT   NOT NULL CHECK (kind IN ('listing', 'offer')),

  -- The exact fields the maker signed. Any divergence makes the on-chain fill revert.
  maker         TEXT   NOT NULL,
  token_id      NUMERIC(78,0) NOT NULL,
  price         NUMERIC(78,0) NOT NULL,
  pay_token     TEXT   NOT NULL,
  nonce         NUMERIC(78,0) NOT NULL,
  expiry        BIGINT NOT NULL,
  signature     TEXT   NOT NULL,
  order_hash    TEXT   NOT NULL,

  status        TEXT   NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'filled', 'cancelled', 'expired')),
  filled_tx     TEXT,
  filled_by     TEXT,
  filled_block  BIGINT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (chain_id, maker, nonce)
);

CREATE INDEX listings_browse ON listings (chain_id, status, created_at DESC);
CREATE INDEX listings_token  ON listings (chain_id, token_id) WHERE status = 'open';
CREATE INDEX listings_maker  ON listings (maker);

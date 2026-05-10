CREATE INDEX IF NOT EXISTS monero_blocks_canonical_hash_idx
  ON monero_blocks (hash)
  WHERE is_canonical;

CREATE INDEX IF NOT EXISTS monero_blocks_noncanonical_height_idx
  ON monero_blocks (height DESC)
  WHERE NOT is_canonical;

CREATE INDEX IF NOT EXISTS monero_blocks_unsettled_height_idx
  ON monero_blocks (height DESC)
  WHERE NOT is_settled;

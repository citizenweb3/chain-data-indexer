-- Ensure height columns are BIGINT to avoid string sorting
ALTER TABLE monero_blocks
  ALTER COLUMN height TYPE BIGINT USING height::bigint;

ALTER TABLE monero_transactions
  ALTER COLUMN block_height TYPE BIGINT USING block_height::bigint;

ALTER TABLE monero_supply_checkpoints
  ALTER COLUMN height TYPE BIGINT USING height::bigint;

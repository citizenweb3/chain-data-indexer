ALTER TABLE logos_blocks
  ADD COLUMN IF NOT EXISTS is_canonical BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS logos_blocks_canonical_height
  ON logos_blocks (height, slot DESC)
  WHERE is_canonical AND height IS NOT NULL;

-- Supports /api/v1/ibc/transfers keyset pagination.
-- Production rollout should use CREATE INDEX CONCURRENTLY outside a transaction.
CREATE INDEX IF NOT EXISTS idx_ibc_packets_event_height
  ON ibc.packets (
    (COALESCE(height_send, height_recv)) DESC NULLS LAST,
    sequence DESC,
    channel_id_src DESC,
    port_id_src DESC
  );

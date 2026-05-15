import type { PoolClient } from 'pg';
import { ensureIbcPacketPartitions } from '../../../db/partitions.ts';
import { execBatchedInsert } from '../batch.ts';
import { dedupeIbcPacketRows, type IbcPacketUpsertRow } from '../ibcPackets.ts';

export async function flushIbcPackets(client: PoolClient, rows: IbcPacketUpsertRow[]): Promise<void> {
  if (!rows.length) return;

  const deduped = dedupeIbcPacketRows(rows);
  await ensureIbcPacketPartitions(
    client,
    deduped.map((row) => row.sequence),
  );

  const columns: string[] = [
    'port_id_src',
    'channel_id_src',
    'sequence',
    'port_id_dst',
    'channel_id_dst',
    'timeout_height',
    'timeout_ts',
    'status',
    'tx_hash_send',
    'height_send',
    'tx_hash_recv',
    'height_recv',
    'tx_hash_ack',
    'height_ack',
    'relayer',
    'denom',
    'amount',
    'memo',
  ];

  const shaped = deduped.map((row) => ({
    ...row,
    sequence: row.sequence.toString(),
    timeout_ts: row.timeout_ts?.toString() ?? null,
  }));

  await execBatchedInsert(
    client,
    'ibc.packets',
    columns,
    shaped,
    `ON CONFLICT (channel_id_src, port_id_src, sequence) DO UPDATE SET
      port_id_dst    = COALESCE(EXCLUDED.port_id_dst, ibc.packets.port_id_dst),
      channel_id_dst = COALESCE(EXCLUDED.channel_id_dst, ibc.packets.channel_id_dst),
      timeout_height = COALESCE(EXCLUDED.timeout_height, ibc.packets.timeout_height),
      timeout_ts     = COALESCE(EXCLUDED.timeout_ts, ibc.packets.timeout_ts),
      status         = CASE
        WHEN EXCLUDED.status IN ('acknowledged', 'timeout', 'failed') THEN EXCLUDED.status
        WHEN ibc.packets.status IN ('acknowledged', 'timeout', 'failed') THEN ibc.packets.status
        WHEN EXCLUDED.status = 'received' THEN 'received'::ibc_packet_status
        ELSE ibc.packets.status
      END,
      tx_hash_send   = COALESCE(EXCLUDED.tx_hash_send, ibc.packets.tx_hash_send),
      height_send    = COALESCE(EXCLUDED.height_send, ibc.packets.height_send),
      tx_hash_recv   = COALESCE(EXCLUDED.tx_hash_recv, ibc.packets.tx_hash_recv),
      height_recv    = COALESCE(EXCLUDED.height_recv, ibc.packets.height_recv),
      tx_hash_ack    = COALESCE(EXCLUDED.tx_hash_ack, ibc.packets.tx_hash_ack),
      height_ack     = COALESCE(EXCLUDED.height_ack, ibc.packets.height_ack),
      relayer        = COALESCE(EXCLUDED.relayer, ibc.packets.relayer),
      denom          = COALESCE(EXCLUDED.denom, ibc.packets.denom),
      amount         = COALESCE(EXCLUDED.amount, ibc.packets.amount),
      memo           = COALESCE(EXCLUDED.memo, ibc.packets.memo)`,
    {
      sequence: 'bigint',
      timeout_ts: 'bigint',
      status: 'ibc_packet_status',
      height_send: 'bigint',
      height_recv: 'bigint',
      height_ack: 'bigint',
      amount: 'numeric',
    },
    { maxRows: 1000, maxParams: 30000 },
  );
}

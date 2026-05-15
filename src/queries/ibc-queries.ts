import { db } from '@/db/indexer-db';

export type IbcPacketStatus = 'sent' | 'received' | 'acknowledged' | 'timeout' | 'failed';

export interface IbcPacketRow {
  port_id_src: string;
  channel_id_src: string;
  sequence: bigint;
  port_id_dst: string | null;
  channel_id_dst: string | null;
  status: IbcPacketStatus;
  timeout_height: string | null;
  timeout_ts: bigint | null;
  tx_hash_send: string | null;
  height_send: bigint | null;
  tx_hash_recv: string | null;
  height_recv: bigint | null;
  tx_hash_ack: string | null;
  height_ack: bigint | null;
  relayer: string | null;
  denom: string | null;
  amount: string | null;
  memo: string | null;
  event_height: bigint | null;
  event_time: Date | null;
}

export async function queryIbcTransfersList(params: {
  limit: number;
  beforeHeight?: bigint;
  beforeSequence?: bigint;
  beforeChannel?: string;
  beforePort?: string;
}): Promise<IbcPacketRow[]> {
  const { limit, beforeHeight, beforeSequence, beforeChannel, beforePort } = params;
  const fetch = limit + 1;

  if (
    beforeHeight !== undefined &&
    beforeSequence !== undefined &&
    beforeChannel !== undefined &&
    beforePort !== undefined
  ) {
    return db<IbcPacketRow[]>`
      SELECT
        p.port_id_src, p.channel_id_src, p.sequence,
        p.port_id_dst, p.channel_id_dst,
        p.status, p.timeout_height, p.timeout_ts,
        p.tx_hash_send, p.height_send,
        p.tx_hash_recv, p.height_recv,
        p.tx_hash_ack,  p.height_ack,
        p.relayer, p.denom, p.amount, p.memo,
        COALESCE(p.height_send, p.height_recv) AS event_height,
        b.time AS event_time
      FROM ibc.packets p
      LEFT JOIN core.blocks b ON b.height = COALESCE(p.height_send, p.height_recv)
      WHERE COALESCE(p.height_send, p.height_recv) IS NOT NULL
        AND (
          COALESCE(p.height_send, p.height_recv) < ${beforeHeight}
          OR (COALESCE(p.height_send, p.height_recv) = ${beforeHeight} AND p.sequence < ${beforeSequence})
          OR (COALESCE(p.height_send, p.height_recv) = ${beforeHeight}
              AND p.sequence = ${beforeSequence}
              AND (p.channel_id_src, p.port_id_src) < (${beforeChannel}, ${beforePort}))
        )
      ORDER BY
        COALESCE(p.height_send, p.height_recv) DESC NULLS LAST,
        p.sequence DESC,
        p.channel_id_src DESC,
        p.port_id_src DESC
      LIMIT ${fetch}
    `;
  }

  return db<IbcPacketRow[]>`
    SELECT
      p.port_id_src, p.channel_id_src, p.sequence,
      p.port_id_dst, p.channel_id_dst,
      p.status, p.timeout_height, p.timeout_ts,
      p.tx_hash_send, p.height_send,
      p.tx_hash_recv, p.height_recv,
      p.tx_hash_ack,  p.height_ack,
      p.relayer, p.denom, p.amount, p.memo,
      COALESCE(p.height_send, p.height_recv) AS event_height,
      b.time AS event_time
    FROM ibc.packets p
    LEFT JOIN core.blocks b ON b.height = COALESCE(p.height_send, p.height_recv)
    ORDER BY
      COALESCE(p.height_send, p.height_recv) DESC NULLS LAST,
      p.sequence DESC,
      p.channel_id_src DESC,
      p.port_id_src DESC
    LIMIT ${fetch}
  `;
}

export async function queryIbcTransferByKey(params: {
  port: string;
  channel: string;
  sequence: bigint;
}): Promise<IbcPacketRow | null> {
  const { port, channel, sequence } = params;
  const rows = await db<IbcPacketRow[]>`
    SELECT
      p.port_id_src, p.channel_id_src, p.sequence,
      p.port_id_dst, p.channel_id_dst,
      p.status, p.timeout_height, p.timeout_ts,
      p.tx_hash_send, p.height_send,
      p.tx_hash_recv, p.height_recv,
      p.tx_hash_ack,  p.height_ack,
      p.relayer, p.denom, p.amount, p.memo,
      COALESCE(p.height_send, p.height_recv) AS event_height,
      b.time AS event_time
    FROM ibc.packets p
    LEFT JOIN core.blocks b ON b.height = COALESCE(p.height_send, p.height_recv)
    WHERE p.channel_id_src = ${channel}
      AND p.port_id_src    = ${port}
      AND p.sequence       = ${sequence}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function queryIbcTransfersTotal(): Promise<bigint> {
  const rows = await db<[{ total: bigint }]>`
    SELECT COUNT(*)::bigint AS total FROM ibc.packets
  `;
  return rows[0]?.total ?? BigInt(0);
}

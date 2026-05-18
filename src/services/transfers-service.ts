import { Prisma } from '@prisma/client';

import { db } from '@/db';
import type {
  IbcTransferDirection,
  IbcTransferDto,
  IbcTransferStatus,
} from '../../server/tools/upstream-types';

export type TransferFilterDirection = IbcTransferDirection | 'both';

export type ListTransfersParams = {
  limit: number;
  beforeHeight?: bigint;
  beforeSequence?: bigint;
  beforeChannel?: string;
  beforePort?: string;
  channelIdSrc?: string;
  channelOnHub?: string;
  direction?: TransferFilterDirection;
  status?: IbcTransferStatus;
  denom?: string;
  denomBase?: string;
  since?: Date;
  offset?: number;
};

export type TransfersListCursor = {
  next_before_height: string;
  next_before_sequence: string;
  next_before_channel: string;
  next_before_port: string;
};

export type TransfersListResult = {
  data: IbcTransferDto[];
  cursor: TransfersListCursor | null;
  has_more: boolean;
  total: string;
};

type PacketRow = {
  channel_id_src: string;
  port_id_src: string;
  sequence: bigint;
  port_id_dst: string | null;
  channel_id_dst: string | null;
  status: string;
  direction: string;
  event_height: bigint | null;
  event_time: Date | null;
  tx_hash_send: string | null;
  height_send: bigint | null;
  tx_hash_recv: string | null;
  height_recv: bigint | null;
  tx_hash_ack: string | null;
  height_ack: bigint | null;
  denom: string | null;
  amount: Prisma.Decimal | null;
  memo: string | null;
  relayer: string | null;
  timeout_height: string | null;
  timeout_ts: bigint | null;
  base_denom?: string | null;
  asset_symbol?: string | null;
  asset_decimals?: number | null;
};

const toDto = (row: PacketRow): IbcTransferDto => ({
  port_id_src: row.port_id_src,
  channel_id_src: row.channel_id_src,
  sequence: row.sequence.toString(),
  port_id_dst: row.port_id_dst,
  channel_id_dst: row.channel_id_dst,
  status: row.status as IbcTransferStatus,
  direction: row.direction as IbcTransferDirection,
  event_height: row.event_height !== null ? row.event_height.toString() : null,
  event_time: row.event_time !== null ? row.event_time.toISOString() : null,
  tx_hash_send: row.tx_hash_send,
  height_send: row.height_send !== null ? row.height_send.toString() : null,
  tx_hash_recv: row.tx_hash_recv,
  height_recv: row.height_recv !== null ? row.height_recv.toString() : null,
  tx_hash_ack: row.tx_hash_ack,
  height_ack: row.height_ack !== null ? row.height_ack.toString() : null,
  denom: row.denom,
  amount: row.amount !== null ? row.amount.toFixed(0) : null,
  memo: row.memo,
  relayer: row.relayer,
  timeout_height: row.timeout_height,
  timeout_ts: row.timeout_ts !== null ? row.timeout_ts.toString() : null,
  base_denom: row.base_denom ?? null,
  asset_symbol: row.asset_symbol ?? null,
  asset_decimals: row.asset_decimals ?? null,
});

const buildFilterConditions = (params: ListTransfersParams): Prisma.Sql[] => {
  const conditions: Prisma.Sql[] = [Prisma.sql`event_height IS NOT NULL`];

  if (params.channelIdSrc !== undefined) {
    conditions.push(Prisma.sql`channel_id_src = ${params.channelIdSrc}`);
  }
  if (params.channelOnHub !== undefined) {
    const ch = params.channelOnHub;
    if (params.direction === 'outgoing') {
      conditions.push(Prisma.sql`channel_id_src = ${ch}`);
    } else if (params.direction === 'incoming') {
      conditions.push(Prisma.sql`channel_id_dst = ${ch}`);
    } else {
      conditions.push(
        Prisma.sql`((direction = 'outgoing' AND channel_id_src = ${ch}) OR (direction = 'incoming' AND channel_id_dst = ${ch}))`,
      );
    }
  }
  if (params.direction !== undefined && params.direction !== 'both') {
    conditions.push(Prisma.sql`direction = ${params.direction}`);
  }
  if (params.status !== undefined) {
    conditions.push(Prisma.sql`status = ${params.status}`);
  }
  if (params.denom !== undefined) {
    conditions.push(Prisma.sql`denom = ${params.denom}`);
  }
  if (params.denomBase !== undefined) {
    conditions.push(Prisma.sql`resolve_base_denom(denom) = ${params.denomBase}`);
  }
  if (params.since !== undefined) {
    conditions.push(Prisma.sql`event_time >= ${params.since}`);
  }

  return conditions;
};

const buildListWhere = (params: ListTransfersParams): Prisma.Sql => {
  const conditions = buildFilterConditions(params);

  const cursorActive =
    params.beforeHeight !== undefined &&
    params.beforeSequence !== undefined &&
    params.beforeChannel !== undefined &&
    params.beforePort !== undefined;

  if (cursorActive) {
    conditions.push(
      Prisma.sql`(event_height, sequence, channel_id_src, port_id_src) < (${params.beforeHeight}, ${params.beforeSequence}, ${params.beforeChannel}, ${params.beforePort})`,
    );
  }

  return Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
};

const buildTotalWhere = (params: ListTransfersParams): Prisma.Sql => {
  const conditions = buildFilterConditions(params);
  return Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
};

export const listTransfers = async (
  params: ListTransfersParams,
): Promise<TransfersListResult> => {
  const whereSql = buildListWhere(params);
  const probeLimit = params.limit + 1;
  const offset = params.offset ?? 0;
  const offsetSql =
    params.offset !== undefined ? Prisma.sql`OFFSET ${offset}` : Prisma.empty;

  const rows = await db.$queryRaw<PacketRow[]>(
    Prisma.sql`
      SELECT
        ibc_packets.channel_id_src,
        ibc_packets.port_id_src,
        ibc_packets.sequence,
        ibc_packets.port_id_dst,
        ibc_packets.channel_id_dst,
        ibc_packets.status,
        ibc_packets.direction,
        ibc_packets.event_height,
        ibc_packets.event_time,
        ibc_packets.tx_hash_send,
        ibc_packets.height_send,
        ibc_packets.tx_hash_recv,
        ibc_packets.height_recv,
        ibc_packets.tx_hash_ack,
        ibc_packets.height_ack,
        ibc_packets.denom,
        ibc_packets.amount,
        ibc_packets.memo,
        ibc_packets.relayer,
        ibc_packets.timeout_height,
        ibc_packets.timeout_ts,
        resolve_base_denom(ibc_packets.denom) AS base_denom,
        assets.symbol AS asset_symbol,
        assets.decimals AS asset_decimals
      FROM ibc_packets
      LEFT JOIN assets ON assets.native_denom = resolve_base_denom(ibc_packets.denom)
      ${whereSql}
      ORDER BY ibc_packets.event_height DESC, ibc_packets.sequence DESC, ibc_packets.channel_id_src DESC, ibc_packets.port_id_src DESC
      LIMIT ${probeLimit}
      ${offsetSql}
    `,
  );

  const hasMore = rows.length > params.limit;
  const pageRows = hasMore ? rows.slice(0, params.limit) : rows;
  const data = pageRows.map(toDto);

  const last = pageRows[pageRows.length - 1];
  const cursor: TransfersListCursor | null =
    hasMore && last && last.event_height !== null && params.offset === undefined
      ? {
          next_before_height: last.event_height.toString(),
          next_before_sequence: last.sequence.toString(),
          next_before_channel: last.channel_id_src,
          next_before_port: last.port_id_src,
        }
      : null;

  const totalRows = await db.$queryRaw<{ total: bigint }[]>(
    Prisma.sql`
      SELECT COUNT(*)::bigint AS total
      FROM ibc_packets
      ${buildTotalWhere(params)}
    `,
  );
  const total = totalRows[0]?.total ?? BigInt(0);

  return { data, cursor, has_more: hasMore, total: total.toString() };
};

export type TransferDetailDto = IbcTransferDto & {
  base_denom: string | null;
  amount_usd: string | null;
  synced_at: string | null;
  asset_symbol: string | null;
  asset_decimals: number | null;
};

type DetailRow = PacketRow & {
  base_denom: string | null;
  amount_usd: Prisma.Decimal | null;
  synced_at: Date | null;
  asset_symbol: string | null;
  asset_decimals: number | null;
};

export const getTransfer = async (params: {
  port: string;
  channel: string;
  sequence: bigint;
}): Promise<TransferDetailDto | null> => {
  const rows = await db.$queryRaw<DetailRow[]>(Prisma.sql`
    WITH daily_spot_prices AS (
      SELECT DISTINCT ON (asset_id, date)
        asset_id,
        (created_at AT TIME ZONE 'UTC')::date AS date,
        usd
      FROM prices
      ORDER BY asset_id, (created_at AT TIME ZONE 'UTC')::date, created_at DESC
    )
    SELECT
      p.channel_id_src,
      p.port_id_src,
      p.sequence,
      p.port_id_dst,
      p.channel_id_dst,
      p.status,
      p.direction,
      p.event_height,
      p.event_time,
      p.tx_hash_send,
      p.height_send,
      p.tx_hash_recv,
      p.height_recv,
      p.tx_hash_ack,
      p.height_ack,
      p.denom,
      p.amount,
      p.memo,
      p.relayer,
      p.timeout_height,
      p.timeout_ts,
      p.synced_at,
      resolve_base_denom(p.denom) AS base_denom,
      a.symbol AS asset_symbol,
      a.decimals AS asset_decimals,
      CASE
        WHEN a.id IS NOT NULL
          AND COALESCE(ph.usd, dsp.usd) IS NOT NULL
          AND p.amount IS NOT NULL
        THEN (p.amount / POWER(10::numeric, a.decimals))
          * COALESCE(ph.usd, dsp.usd)
      END AS amount_usd
    FROM ibc_packets p
    LEFT JOIN assets a ON a.native_denom = resolve_base_denom(p.denom)
    LEFT JOIN price_history ph ON ph.asset_id = a.id
      AND ph.date = (p.event_time AT TIME ZONE 'UTC')::date
    LEFT JOIN daily_spot_prices dsp ON dsp.asset_id = a.id
      AND dsp.date = (p.event_time AT TIME ZONE 'UTC')::date
    WHERE p.channel_id_src = ${params.channel}
      AND p.port_id_src = ${params.port}
      AND p.sequence = ${params.sequence}
    LIMIT 1
  `);

  const row = rows[0];
  if (!row) return null;

  const base = toDto(row);
  return {
    ...base,
    base_denom: row.base_denom,
    amount_usd: row.amount_usd !== null ? row.amount_usd.toFixed(2) : null,
    synced_at: row.synced_at !== null ? row.synced_at.toISOString() : null,
    asset_symbol: row.asset_symbol,
    asset_decimals: row.asset_decimals,
  };
};

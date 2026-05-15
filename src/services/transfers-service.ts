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
  direction?: TransferFilterDirection;
  status?: IbcTransferStatus;
  denom?: string;
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
});

const buildFilterConditions = (params: ListTransfersParams): Prisma.Sql[] => {
  const conditions: Prisma.Sql[] = [];

  if (params.channelIdSrc !== undefined) {
    conditions.push(Prisma.sql`channel_id_src = ${params.channelIdSrc}`);
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
    conditions.push(Prisma.sql`event_height IS NOT NULL`);
    conditions.push(
      Prisma.sql`(event_height, sequence, channel_id_src, port_id_src) < (${params.beforeHeight}, ${params.beforeSequence}, ${params.beforeChannel}, ${params.beforePort})`,
    );
  }

  if (conditions.length === 0) return Prisma.empty;
  return Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
};

const buildTotalWhere = (params: ListTransfersParams): Prisma.Sql => {
  const conditions = buildFilterConditions(params);
  if (conditions.length === 0) return Prisma.empty;
  return Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
};

export const listTransfers = async (
  params: ListTransfersParams,
): Promise<TransfersListResult> => {
  const whereSql = buildListWhere(params);
  const probeLimit = params.limit + 1;

  const rows = await db.$queryRaw<PacketRow[]>(
    Prisma.sql`
      SELECT
        channel_id_src,
        port_id_src,
        sequence,
        port_id_dst,
        channel_id_dst,
        status,
        direction,
        event_height,
        event_time,
        tx_hash_send,
        height_send,
        tx_hash_recv,
        height_recv,
        tx_hash_ack,
        height_ack,
        denom,
        amount,
        memo,
        relayer,
        timeout_height,
        timeout_ts
      FROM ibc_packets
      ${whereSql}
      ORDER BY event_height DESC NULLS LAST, sequence DESC, channel_id_src DESC, port_id_src DESC
      LIMIT ${probeLimit}
    `,
  );

  const hasMore = rows.length > params.limit;
  const pageRows = hasMore ? rows.slice(0, params.limit) : rows;
  const data = pageRows.map(toDto);

  const lastWithHeight = [...pageRows].reverse().find((r) => r.event_height !== null);
  const cursor: TransfersListCursor | null =
    hasMore && lastWithHeight && lastWithHeight.event_height !== null
      ? {
          next_before_height: lastWithHeight.event_height.toString(),
          next_before_sequence: lastWithHeight.sequence.toString(),
          next_before_channel: lastWithHeight.channel_id_src,
          next_before_port: lastWithHeight.port_id_src,
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

export const getTransfer = async (params: {
  port: string;
  channel: string;
  sequence: bigint;
}): Promise<IbcTransferDto | null> => {
  const row = await db.ibcPacket.findUnique({
    where: {
      channelIdSrc_portIdSrc_sequence: {
        channelIdSrc: params.channel,
        portIdSrc: params.port,
        sequence: params.sequence,
      },
    },
  });

  if (!row) return null;

  return toDto({
    channel_id_src: row.channelIdSrc,
    port_id_src: row.portIdSrc,
    sequence: row.sequence,
    port_id_dst: row.portIdDst,
    channel_id_dst: row.channelIdDst,
    status: row.status,
    direction: row.direction,
    event_height: row.eventHeight,
    event_time: row.eventTime,
    tx_hash_send: row.txHashSend,
    height_send: row.heightSend,
    tx_hash_recv: row.txHashRecv,
    height_recv: row.heightRecv,
    tx_hash_ack: row.txHashAck,
    height_ack: row.heightAck,
    denom: row.denom,
    amount: row.amount,
    memo: row.memo,
    relayer: row.relayer,
    timeout_height: row.timeoutHeight,
    timeout_ts: row.timeoutTs,
  });
};

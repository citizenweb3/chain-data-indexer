import {
  queryIbcTransferByKey,
  queryIbcTransfersList,
  queryIbcTransfersTotal,
  type IbcPacketRow,
  type IbcPacketStatus,
} from '@/queries/ibc-queries';

export type IbcTransferDirection = 'outgoing' | 'incoming';

export interface IbcTransferDto {
  port_id_src: string;
  channel_id_src: string;
  sequence: string;
  port_id_dst: string | null;
  channel_id_dst: string | null;
  status: IbcPacketStatus;
  direction: IbcTransferDirection;
  event_height: string | null;
  event_time: string | null;
  tx_hash_send: string | null;
  height_send: string | null;
  tx_hash_recv: string | null;
  height_recv: string | null;
  tx_hash_ack: string | null;
  height_ack: string | null;
  denom: string | null;
  amount: string | null;
  memo: string | null;
  relayer: string | null;
  timeout_height: string | null;
  timeout_ts: string | null;
}

export interface IbcTransfersCursor {
  next_before_height: string;
  next_before_sequence: string;
  next_before_channel: string;
  next_before_port: string;
}

export interface IbcTransfersListResult {
  data: IbcTransferDto[];
  cursor: IbcTransfersCursor | null;
  has_more: boolean;
  total: string;
}

function toDto(row: IbcPacketRow): IbcTransferDto {
  return {
    port_id_src: row.port_id_src,
    channel_id_src: row.channel_id_src,
    sequence: row.sequence.toString(),
    port_id_dst: row.port_id_dst,
    channel_id_dst: row.channel_id_dst,
    status: row.status,
    direction: row.tx_hash_send !== null ? 'outgoing' : 'incoming',
    event_height: row.event_height !== null ? row.event_height.toString() : null,
    event_time: row.event_time !== null ? row.event_time.toISOString() : null,
    tx_hash_send: row.tx_hash_send,
    height_send: row.height_send !== null ? row.height_send.toString() : null,
    tx_hash_recv: row.tx_hash_recv,
    height_recv: row.height_recv !== null ? row.height_recv.toString() : null,
    tx_hash_ack: row.tx_hash_ack,
    height_ack: row.height_ack !== null ? row.height_ack.toString() : null,
    denom: row.denom,
    amount: row.amount,
    memo: row.memo,
    relayer: row.relayer,
    timeout_height: row.timeout_height,
    timeout_ts: row.timeout_ts !== null ? row.timeout_ts.toString() : null,
  };
}

export async function listIbcTransfers(params: {
  limit: number;
  beforeHeight?: bigint;
  beforeSequence?: bigint;
  beforeChannel?: string;
  beforePort?: string;
}): Promise<IbcTransfersListResult> {
  const [rows, total] = await Promise.all([queryIbcTransfersList(params), queryIbcTransfersTotal()]);

  const hasMore = rows.length > params.limit;
  const pageRows = hasMore ? rows.slice(0, params.limit) : rows;
  const data = pageRows.map(toDto);

  const last = pageRows.at(-1);
  const cursor: IbcTransfersCursor | null =
    hasMore && last !== undefined && last.event_height !== null
      ? {
          next_before_height: last.event_height.toString(),
          next_before_sequence: last.sequence.toString(),
          next_before_channel: last.channel_id_src,
          next_before_port: last.port_id_src,
        }
      : null;

  return { data, cursor, has_more: hasMore, total: total.toString() };
}

export async function getIbcTransfer(params: {
  port: string;
  channel: string;
  sequence: bigint;
}): Promise<IbcTransferDto | null> {
  const row = await queryIbcTransferByKey(params);
  if (!row) return null;
  return toDto(row);
}

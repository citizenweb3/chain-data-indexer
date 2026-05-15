import { findAttr } from './parsing.ts';

export type IbcPacketStatus = 'sent' | 'received' | 'acknowledged' | 'timeout' | 'failed';

export interface IbcPacketUpsertRow {
  port_id_src: string;
  channel_id_src: string;
  sequence: bigint;
  port_id_dst: string | null;
  channel_id_dst: string | null;
  timeout_height: string | null;
  timeout_ts: bigint | null;
  status: IbcPacketStatus;
  tx_hash_send: string | null;
  height_send: number | null;
  tx_hash_recv: string | null;
  height_recv: number | null;
  tx_hash_ack: string | null;
  height_ack: number | null;
  relayer: string | null;
  denom: string | null;
  amount: string | null;
  memo: string | null;
}

export interface IbcPacketEventContext {
  eventType: string;
  height: number;
  txHash: string;
  relayer: string | null;
}

const TERMINAL_STATUSES = new Set<IbcPacketStatus>(['acknowledged', 'timeout', 'failed']);
const PG_BIGINT_MAX = 9_223_372_036_854_775_807n;

function firstAttr(attrs: Array<{ key: string; value: string | null }>, keys: string[]): string | null {
  for (const key of keys) {
    const value = findAttr(attrs, key);
    if (value !== null && value !== '') return value;
  }
  return null;
}

function parseBigIntValue(value: string | null): bigint | null {
  if (!value || !/^\d+$/.test(value)) return null;
  try {
    const parsed = BigInt(value);
    return parsed <= PG_BIGINT_MAX ? parsed : null;
  } catch {
    return null;
  }
}

function decodeJsonLike(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const direct = tryParseJson(trimmed);
  if (direct !== null) return direct;

  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    const fromHex = tryParseJson(Buffer.from(trimmed, 'hex').toString('utf8'));
    if (fromHex !== null) return fromHex;
  }

  if (/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    const fromBase64 = tryParseJson(Buffer.from(trimmed, 'base64').toString('utf8'));
    if (fromBase64 !== null) return fromBase64;
  }

  return null;
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parsePacketData(value: string | null): { denom: string | null; amount: string | null; memo: string | null } {
  if (!value) return { denom: null, amount: null, memo: null };
  const decoded = decodeJsonLike(value);
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    return { denom: null, amount: null, memo: null };
  }

  const packet = decoded as Record<string, unknown>;
  const denom = typeof packet.denom === 'string' && packet.denom.length > 0 ? packet.denom : null;
  const amount = typeof packet.amount === 'string' && /^\d+$/.test(packet.amount) ? packet.amount : null;
  const memo = typeof packet.memo === 'string' && packet.memo.length > 0 ? packet.memo : null;

  return { denom, amount, memo };
}

function acknowledgementFailed(value: string | null): boolean {
  if (!value) return false;
  const decoded = decodeJsonLike(value);
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return false;

  const ack = decoded as Record<string, unknown>;
  return typeof ack.error === 'string' && ack.error.length > 0;
}

function chooseStatus(current: IbcPacketStatus, next: IbcPacketStatus): IbcPacketStatus {
  if (TERMINAL_STATUSES.has(next)) return next;
  if (TERMINAL_STATUSES.has(current)) return current;
  if (next === 'received') return 'received';
  return current;
}

function mergeIbcPacketRows(current: IbcPacketUpsertRow, next: IbcPacketUpsertRow): IbcPacketUpsertRow {
  return {
    port_id_src: current.port_id_src,
    channel_id_src: current.channel_id_src,
    sequence: current.sequence,
    port_id_dst: next.port_id_dst ?? current.port_id_dst,
    channel_id_dst: next.channel_id_dst ?? current.channel_id_dst,
    timeout_height: next.timeout_height ?? current.timeout_height,
    timeout_ts: next.timeout_ts ?? current.timeout_ts,
    status: chooseStatus(current.status, next.status),
    tx_hash_send: next.tx_hash_send ?? current.tx_hash_send,
    height_send: next.height_send ?? current.height_send,
    tx_hash_recv: next.tx_hash_recv ?? current.tx_hash_recv,
    height_recv: next.height_recv ?? current.height_recv,
    tx_hash_ack: next.tx_hash_ack ?? current.tx_hash_ack,
    height_ack: next.height_ack ?? current.height_ack,
    relayer: next.relayer ?? current.relayer,
    denom: next.denom ?? current.denom,
    amount: next.amount ?? current.amount,
    memo: next.memo ?? current.memo,
  };
}

export function dedupeIbcPacketRows(rows: IbcPacketUpsertRow[]): IbcPacketUpsertRow[] {
  const byKey = new Map<string, IbcPacketUpsertRow>();

  for (const row of rows) {
    const key = `${row.channel_id_src}\x1f${row.port_id_src}\x1f${row.sequence.toString()}`;
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergeIbcPacketRows(existing, row) : row);
  }

  return [...byKey.values()];
}

export function extractIbcPacketRow(
  attrs: Array<{ key: string; value: string | null }>,
  ctx: IbcPacketEventContext,
): IbcPacketUpsertRow | null {
  if (
    ctx.eventType !== 'send_packet' &&
    ctx.eventType !== 'recv_packet' &&
    ctx.eventType !== 'acknowledge_packet' &&
    ctx.eventType !== 'timeout_packet' &&
    ctx.eventType !== 'write_acknowledgement'
  ) {
    return null;
  }

  const portIdSrc = firstAttr(attrs, ['packet_src_port', 'packet_src_port_id']);
  const channelIdSrc = firstAttr(attrs, ['packet_src_channel', 'packet_src_channel_id']);
  const sequence = parseBigIntValue(firstAttr(attrs, ['packet_sequence']));
  if (!portIdSrc || !channelIdSrc || sequence === null) return null;

  const portIdDst = firstAttr(attrs, ['packet_dst_port', 'packet_dst_port_id']);
  const channelIdDst = firstAttr(attrs, ['packet_dst_channel', 'packet_dst_channel_id']);
  const timeoutHeight = firstAttr(attrs, ['packet_timeout_height']);
  const timeoutTs = parseBigIntValue(firstAttr(attrs, ['packet_timeout_timestamp']));
  const packetData = parsePacketData(firstAttr(attrs, ['packet_data', 'packet_data_hex']));
  const ackValue = firstAttr(attrs, ['packet_ack', 'packet_ack_hex', 'packet_acknowledgement', 'acknowledgement']);

  const base = {
    port_id_src: portIdSrc,
    channel_id_src: channelIdSrc,
    sequence,
    port_id_dst: portIdDst,
    channel_id_dst: channelIdDst,
    timeout_height: timeoutHeight,
    timeout_ts: timeoutTs,
    tx_hash_send: null,
    height_send: null,
    tx_hash_recv: null,
    height_recv: null,
    tx_hash_ack: null,
    height_ack: null,
    relayer: null,
    denom: packetData.denom,
    amount: packetData.amount,
    memo: packetData.memo,
  };

  if (ctx.eventType === 'send_packet') {
    return {
      ...base,
      status: 'sent',
      tx_hash_send: ctx.txHash,
      height_send: ctx.height,
    };
  }

  if (ctx.eventType === 'recv_packet') {
    return {
      ...base,
      status: 'received',
      tx_hash_recv: ctx.txHash,
      height_recv: ctx.height,
      relayer: ctx.relayer,
    };
  }

  if (ctx.eventType === 'acknowledge_packet') {
    return {
      ...base,
      status: acknowledgementFailed(ackValue) ? 'failed' : 'acknowledged',
      tx_hash_ack: ctx.txHash,
      height_ack: ctx.height,
      relayer: ctx.relayer,
    };
  }

  if (ctx.eventType === 'timeout_packet') {
    return {
      ...base,
      status: 'timeout',
      tx_hash_ack: ctx.txHash,
      height_ack: ctx.height,
      relayer: ctx.relayer,
    };
  }

  if (!acknowledgementFailed(ackValue)) return null;

  return {
    ...base,
    status: 'failed',
    relayer: ctx.relayer,
  };
}

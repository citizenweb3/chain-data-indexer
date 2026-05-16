import { db } from '@/db';
import logger from '@/logger';
import { fetchUpstream } from '../tools/upstream-client';
import type {
  IbcTransferDto,
  IbcTransfersListResponse,
} from '../tools/upstream-types';

const log = logger('sync-ibc-transfers');

const PAGE_SIZE = 100;
const BACKFILL_DAYS = 30;

type PacketCursor = {
  eventHeight: bigint;
  sequence: bigint;
  channel: string;
  port: string;
};

const compareCursor = (
  candidate: PacketCursor,
  baseline: PacketCursor,
): number => {
  if (candidate.eventHeight !== baseline.eventHeight) {
    return candidate.eventHeight < baseline.eventHeight ? -1 : 1;
  }
  if (candidate.sequence !== baseline.sequence) {
    return candidate.sequence < baseline.sequence ? -1 : 1;
  }
  if (candidate.channel !== baseline.channel) {
    return candidate.channel < baseline.channel ? -1 : 1;
  }
  if (candidate.port !== baseline.port) {
    return candidate.port < baseline.port ? -1 : 1;
  }
  return 0;
};

const readLatestPacket = async (): Promise<PacketCursor | null> => {
  const row = await db.ibcPacket.findFirst({
    where: { eventHeight: { not: null } },
    orderBy: [
      { eventHeight: 'desc' },
      { sequence: 'desc' },
      { channelIdSrc: 'desc' },
      { portIdSrc: 'desc' },
    ],
    select: {
      eventHeight: true,
      sequence: true,
      channelIdSrc: true,
      portIdSrc: true,
    },
  });
  if (!row || row.eventHeight === null) return null;
  return {
    eventHeight: row.eventHeight,
    sequence: row.sequence,
    channel: row.channelIdSrc,
    port: row.portIdSrc,
  };
};

const readEarliestEventTime = async (): Promise<Date | null> => {
  const row = await db.ibcPacket.findFirst({
    where: { eventTime: { not: null } },
    orderBy: [{ eventTime: 'asc' }],
    select: { eventTime: true },
  });
  return row?.eventTime ?? null;
};

const parseAmount = (value: string | null): string | null => {
  if (value === null) return null;
  if (!/^-?\d+$/.test(value)) return null;
  return value;
};

const upsertPacket = async (dto: IbcTransferDto): Promise<boolean> => {
  const sequence = BigInt(dto.sequence);
  const eventHeight = dto.event_height !== null ? BigInt(dto.event_height) : null;
  const eventTime = dto.event_time !== null ? new Date(dto.event_time) : null;
  const heightSend = dto.height_send !== null ? BigInt(dto.height_send) : null;
  const heightRecv = dto.height_recv !== null ? BigInt(dto.height_recv) : null;
  const heightAck = dto.height_ack !== null ? BigInt(dto.height_ack) : null;
  const timeoutTs = dto.timeout_ts !== null ? BigInt(dto.timeout_ts) : null;
  const amount = parseAmount(dto.amount);

  const data = {
    portIdDst: dto.port_id_dst,
    channelIdDst: dto.channel_id_dst,
    status: dto.status,
    direction: dto.direction,
    eventHeight,
    eventTime,
    txHashSend: dto.tx_hash_send,
    heightSend,
    txHashRecv: dto.tx_hash_recv,
    heightRecv,
    txHashAck: dto.tx_hash_ack,
    heightAck,
    denom: dto.denom,
    amount,
    memo: dto.memo,
    relayer: dto.relayer,
    timeoutHeight: dto.timeout_height,
    timeoutTs,
  };

  const existing = await db.ibcPacket.findUnique({
    where: {
      channelIdSrc_portIdSrc_sequence: {
        channelIdSrc: dto.channel_id_src,
        portIdSrc: dto.port_id_src,
        sequence,
      },
    },
    select: { channelIdSrc: true },
  });

  if (existing) {
    await db.ibcPacket.update({
      where: {
        channelIdSrc_portIdSrc_sequence: {
          channelIdSrc: dto.channel_id_src,
          portIdSrc: dto.port_id_src,
          sequence,
        },
      },
      data,
    });
    return false;
  }

  await db.ibcPacket.create({
    data: {
      channelIdSrc: dto.channel_id_src,
      portIdSrc: dto.port_id_src,
      sequence,
      ...data,
    },
  });
  return true;
};

export const runSyncIbcTransfers = async (): Promise<void> => {
  const startedAt = Date.now();
  log.logInfo('sync-ibc-transfers started');

  const backfillCutoff = new Date(Date.now() - BACKFILL_DAYS * 24 * 60 * 60 * 1000);
  const latest = await readLatestPacket();
  const earliestEventTime = await readEarliestEventTime();
  const windowComplete =
    earliestEventTime !== null && earliestEventTime <= backfillCutoff;

  log.logInfo('sync-ibc-transfers: state', {
    hasLatest: latest !== null,
    earliestEventTime: earliestEventTime?.toISOString() ?? null,
    backfillCutoff: backfillCutoff.toISOString(),
    windowComplete,
    mode: windowComplete ? 'delta' : 'backfill',
  });

  let beforeHeight: string | undefined;
  let beforeSequence: string | undefined;
  let beforeChannel: string | undefined;
  let beforePort: string | undefined;

  let pagesFetched = 0;
  let newCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let stopped = false;

  while (true) {
    const params: Record<string, string | number | undefined> = {
      limit: PAGE_SIZE,
      before_height: beforeHeight,
      before_sequence: beforeSequence,
      before_channel: beforeChannel,
      before_port: beforePort,
    };

    const response = await fetchUpstream<IbcTransfersListResponse>('/ibc/transfers', params);
    pagesFetched++;

    const items = response.data;
    if (items.length === 0) {
      log.logInfo('upstream returned empty page', { pagesFetched });
      break;
    }

    for (const dto of items) {
      if (dto.event_height === null) {
        skippedCount++;
        continue;
      }

      const candidate: PacketCursor = {
        eventHeight: BigInt(dto.event_height),
        sequence: BigInt(dto.sequence),
        channel: dto.channel_id_src,
        port: dto.port_id_src,
      };

      if (dto.event_time !== null) {
        const eventTime = new Date(dto.event_time);
        if (eventTime < backfillCutoff) {
          stopped = true;
          break;
        }
      }

      if (windowComplete && latest && compareCursor(candidate, latest) <= 0) {
        stopped = true;
        break;
      }

      const inserted = await upsertPacket(dto);
      if (inserted) newCount++;
      else updatedCount++;
    }

    if (stopped) break;

    if (!response.has_more || !response.cursor) break;
    beforeHeight = response.cursor.next_before_height ?? undefined;
    beforeSequence = response.cursor.next_before_sequence;
    beforeChannel = response.cursor.next_before_channel;
    beforePort = response.cursor.next_before_port;
  }

  const elapsedMs = Date.now() - startedAt;
  log.logInfo('sync-ibc-transfers finished', {
    new: newCount,
    updated: updatedCount,
    skipped: skippedCount,
    pagesFetched,
    elapsedMs,
    mode: windowComplete ? 'delta' : 'backfill',
  });
};

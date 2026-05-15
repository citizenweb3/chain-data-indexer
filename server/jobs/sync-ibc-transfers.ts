import { db } from '@/db';
import logger from '@/logger';
import { fetchUpstream } from '../tools/upstream-client';
import type {
  IbcTransferDto,
  IbcTransfersListResponse,
} from '../tools/upstream-types';

const log = logger('sync-ibc-transfers');

const SYNC_KEY = 'ibc-transfers';
const PAGE_SIZE = 100;
const MAX_PAGES = 500;
const BACKFILL_DAYS = 30;

type Watermark = {
  eventHeight: bigint;
  sequence: bigint;
  channel: string;
  port: string;
};

const compareWatermark = (
  candidate: { eventHeight: bigint; sequence: bigint; channel: string; port: string },
  baseline: Watermark,
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

const readWatermark = async (): Promise<Watermark | null> => {
  const row = await db.syncCursor.findUnique({ where: { key: SYNC_KEY } });
  if (
    !row ||
    row.lastEventHeight === null ||
    row.lastSequence === null ||
    row.lastChannel === null ||
    row.lastPort === null
  ) {
    return null;
  }
  return {
    eventHeight: row.lastEventHeight,
    sequence: row.lastSequence,
    channel: row.lastChannel,
    port: row.lastPort,
  };
};

const writeWatermark = async (wm: Watermark): Promise<void> => {
  await db.syncCursor.upsert({
    where: { key: SYNC_KEY },
    update: {
      lastEventHeight: wm.eventHeight,
      lastSequence: wm.sequence,
      lastChannel: wm.channel,
      lastPort: wm.port,
    },
    create: {
      key: SYNC_KEY,
      lastEventHeight: wm.eventHeight,
      lastSequence: wm.sequence,
      lastChannel: wm.channel,
      lastPort: wm.port,
    },
  });
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

  const watermark = await readWatermark();
  const backfillCutoff = new Date(Date.now() - BACKFILL_DAYS * 24 * 60 * 60 * 1000);

  let nextWatermark: Watermark | null = null;
  let beforeHeight: string | undefined;
  let beforeSequence: string | undefined;
  let beforeChannel: string | undefined;
  let beforePort: string | undefined;

  let pagesFetched = 0;
  let newCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let stopped = false;

  for (let page = 0; page < MAX_PAGES; page++) {
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
      log.logInfo('upstream returned empty page', { page });
      break;
    }

    if (page === 0) {
      const newest = items.find((p) => p.event_height !== null);
      if (newest && newest.event_height !== null) {
        nextWatermark = {
          eventHeight: BigInt(newest.event_height),
          sequence: BigInt(newest.sequence),
          channel: newest.channel_id_src,
          port: newest.port_id_src,
        };
      }
    }

    for (const dto of items) {
      if (dto.event_height === null) {
        skippedCount++;
        continue;
      }

      const candidate = {
        eventHeight: BigInt(dto.event_height),
        sequence: BigInt(dto.sequence),
        channel: dto.channel_id_src,
        port: dto.port_id_src,
      };

      if (watermark && compareWatermark(candidate, watermark) <= 0) {
        stopped = true;
        break;
      }

      if (!watermark && dto.event_time !== null) {
        const eventTime = new Date(dto.event_time);
        if (eventTime < backfillCutoff) {
          stopped = true;
          break;
        }
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

  if (nextWatermark) {
    await writeWatermark(nextWatermark);
  }

  const elapsedMs = Date.now() - startedAt;
  log.logInfo('sync-ibc-transfers finished', {
    new: newCount,
    updated: updatedCount,
    skipped: skippedCount,
    pagesFetched,
    elapsedMs,
    watermarkUpdated: nextWatermark !== null,
  });
};

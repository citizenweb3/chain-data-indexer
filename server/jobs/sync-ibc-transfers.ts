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
const CURSOR_KEY = 'sync-ibc-transfers';

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

const readLatestPacket = async (chain: string): Promise<PacketCursor | null> => {
  const row = await db.ibcPacket.findFirst({
    where: { chain, eventHeight: { not: null } },
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

const readEarliestEventTime = async (chain: string): Promise<Date | null> => {
  const row = await db.ibcPacket.findFirst({
    where: { chain, eventTime: { not: null } },
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

const upsertPacket = async (chain: string, dto: IbcTransferDto): Promise<boolean> => {
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
      chain_channelIdSrc_portIdSrc_sequence: {
        chain,
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
        chain_channelIdSrc_portIdSrc_sequence: {
          chain,
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
      chain,
      channelIdSrc: dto.channel_id_src,
      portIdSrc: dto.port_id_src,
      sequence,
      ...data,
    },
  });
  return true;
};

const writeCursor = async (
  chain: string,
  latest: PacketCursor | null,
): Promise<void> => {
  await db.syncCursor.upsert({
    where: { chain_key: { chain, key: CURSOR_KEY } },
    create: {
      chain,
      key: CURSOR_KEY,
      lastEventHeight: latest?.eventHeight ?? null,
      lastSequence: latest?.sequence ?? null,
      lastChannel: latest?.channel ?? null,
      lastPort: latest?.port ?? null,
    },
    update: {
      lastEventHeight: latest?.eventHeight ?? null,
      lastSequence: latest?.sequence ?? null,
      lastChannel: latest?.channel ?? null,
      lastPort: latest?.port ?? null,
    },
  });
};

const syncOneChain = async (chain: string): Promise<void> => {
  const startedAt = Date.now();
  log.logInfo(`[${chain}] sync-ibc-transfers started`);

  const backfillCutoff = new Date(Date.now() - BACKFILL_DAYS * 24 * 60 * 60 * 1000);
  const latest = await readLatestPacket(chain);
  const earliestEventTime = await readEarliestEventTime(chain);
  const windowComplete =
    earliestEventTime !== null && earliestEventTime <= backfillCutoff;

  log.logInfo(`[${chain}] sync-ibc-transfers: state`, {
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
  const discoveredChannels = new Set<string>();

  while (true) {
    const params: Record<string, string | number | undefined> = {
      limit: PAGE_SIZE,
      before_height: beforeHeight,
      before_sequence: beforeSequence,
      before_channel: beforeChannel,
      before_port: beforePort,
    };

    const response = await fetchUpstream<IbcTransfersListResponse>(chain, '/ibc/transfers', params);
    pagesFetched++;

    const items = response.data;
    if (items.length === 0) {
      log.logInfo(`[${chain}] upstream returned empty page`, { pagesFetched });
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

      const inserted = await upsertPacket(chain, dto);
      if (inserted) newCount++;
      else updatedCount++;

      discoveredChannels.add(`${dto.channel_id_src}|${dto.port_id_src}`);
    }

    if (stopped) break;

    if (!response.has_more || !response.cursor) break;
    beforeHeight = response.cursor.next_before_height ?? undefined;
    beforeSequence = response.cursor.next_before_sequence;
    beforeChannel = response.cursor.next_before_channel;
    beforePort = response.cursor.next_before_port;
  }

  await writeCursor(chain, await readLatestPacket(chain));

  let discoveredInserted = 0;
  if (discoveredChannels.size > 0) {
    const rows = [...discoveredChannels].map((key) => {
      const [channelIdSrc, portIdSrc] = key.split('|');
      return {
        chain,
        channelIdSrc,
        portIdSrc,
        counterpartyChainId: '__unknown__',
        counterpartyChainName: '__unknown__',
      };
    });
    const result = await db.ibcChannel.createMany({
      data: rows,
      skipDuplicates: true,
    });
    discoveredInserted = result.count;
  }

  const elapsedMs = Date.now() - startedAt;
  log.logInfo(`[${chain}] sync-ibc-transfers finished`, {
    new: newCount,
    updated: updatedCount,
    skipped: skippedCount,
    discoveredChannels: discoveredChannels.size,
    discoveredInserted,
    pagesFetched,
    elapsedMs,
    mode: windowComplete ? 'delta' : 'backfill',
  });
};

export const runSyncIbcTransfers = async (chains: string[]): Promise<void> => {
  for (const chain of chains) {
    try {
      await syncOneChain(chain);
    } catch (err) {
      log.logError(`[${chain}] sync-ibc-transfers failed`, err);
    }
  }
};

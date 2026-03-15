/**
 * Entry point for the Cosmos indexer application.
 * Initializes configuration, RPC client, decoding pool, and sink.
 * Handles backfilling blockchain data and optionally follows new blocks in real-time.
 * Responds to SIGINT and SIGTERM signals to gracefully shut down.
 */
// src/index.ts
import { EventEmitter } from 'node:events';
import { cpus } from 'node:os';
import { getConfig, printConfig } from './config.ts';
import { createRpcClientFromConfig } from './rpc/client.ts';
import { createTxDecodePool, TxDecodePool } from './decode/txPool.ts';
import { createSink } from './sink/index.ts';
import { Sink } from './sink/types.ts';
import type { Config } from './types.js';
import { closePgPool, createPgPool, getPgPool } from './db/pg.ts';
import { getProgress } from './db/progress.ts';
import {
  bulkModeOff,
  detectBulkModeStatus,
  disableAutovacuum,
  findBulkModeOverlapTables,
  getBulkModeSafetyError,
  getBulkModeTopologyError,
} from './db/bulk-mode.ts';
import { getLogger } from './utils/logger.ts';
import { syncRange } from './runner/syncRange.ts';
import { followLoop } from './runner/follow.ts';

EventEmitter.defaultMaxListeners = 0;
const log = getLogger('index');

let activeSink: Sink | null = null;
let activePool: TxDecodePool | null = null;
let shuttingDown = false;

type ClickHouseResumeConfig = NonNullable<Config['ch']>;
type ClickHouseResumeRow = {
  max_height?: number | string | null;
};

function parseClickHouseMaxHeight(payload: unknown): number | null {
  const rows = Array.isArray(payload)
    ? payload
    : payload &&
        typeof payload === 'object' &&
        'data' in payload &&
        Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : null;

  if (!rows) {
    throw new Error('Unexpected ClickHouse response shape for resume query.');
  }

  const row = rows[0] as ClickHouseResumeRow | undefined;
  const rawHeight = row?.max_height;
  if (rawHeight == null) {
    return null;
  }

  const height = typeof rawHeight === 'number' ? rawHeight : Number(rawHeight);
  if (!Number.isFinite(height)) {
    throw new Error(`Invalid ClickHouse max(height) value: "${rawHeight}"`);
  }

  return height;
}

async function getClickHouseMaxHeight(cfg: ClickHouseResumeConfig): Promise<number | null> {
  const { createClient } = await import('@clickhouse/client');
  const client = createClient({
    url: cfg.url,
    username: cfg.username,
    password: cfg.password,
    database: cfg.database,
    application: 'cosmos-indexer-resolver',
  });

  try {
    const resultSet = await client.query({
      query: 'SELECT max(height) AS max_height FROM core.blocks',
      format: 'JSONEachRow',
    });

    return parseClickHouseMaxHeight(await resultSet.json());
  } finally {
    await client.close();
  }
}

async function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.warn(`${signal} received, flushing buffers…`);
  try {
    await activeSink?.flush?.();
    await activeSink?.close();
    await activePool?.close();
    log.info('graceful shutdown complete');
  } catch (e) {
    log.error(`shutdown error: ${e}`);
  }
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

/**
 * Main function that runs the indexing process.
 * It resolves configuration, determines starting and ending block heights,
 * sets up RPC client, decode pool, and sink, performs range backfill,
 * and if enabled, follows new blocks in real-time.
 *
 * @returns {Promise<void>} Resolves when the indexing process completes or exits.
 */
async function main() {
  const cfg = getConfig();
  printConfig(cfg);
  const progressId = cfg.pg?.progressId ?? 'default';

  const rpc = createRpcClientFromConfig(cfg);
  const status = await rpc.fetchStatus();

  let startFrom = cfg.from as number | undefined;
  const wantResume =
    !startFrom || cfg.resume === true || (typeof cfg.from === 'string' && cfg.from.toLowerCase() === 'resume');
  const earliest = Number(status['sync_info']['earliest_block_height']);
  const explicitFrom = typeof cfg.from === 'number' ? cfg.from : (cfg.firstBlock as number | undefined);

  if (wantResume) {
    if (cfg.sinkKind === 'postgres') {
      const pool = createPgPool({ ...cfg.pg, applicationName: 'cosmos-indexer-resolver' });
      try {
        const last = await getProgress(pool, progressId);
        startFrom = last != null ? last + 1 : (explicitFrom ?? earliest);
        log.info(`[resume] last_height=${last ?? 'null'} → start from ${startFrom}`);
      } finally {
        await closePgPool();
      }
    } else if (cfg.sinkKind === 'clickhouse') {
      if (!cfg.ch) {
        throw new Error('ClickHouse configuration is required when SINK=clickhouse');
      }

      const last = await getClickHouseMaxHeight(cfg.ch);
      startFrom = last != null ? last + 1 : (explicitFrom ?? earliest);
      log.info(`[resume] clickhouse max_height=${last ?? 'null'} → start from ${startFrom}`);
    } else {
      log.warn('[resume] requested, but sinkKind is neither postgres nor clickhouse — skipping.');
    }
  }

  let endHeight = cfg.to as number | undefined;
  if (!endHeight) {
    endHeight = Number(status['sync_info']['latest_block_height']);
    log.info(`[config] --to not provided → using latest height ${endHeight}`);
  }
  if (startFrom == null || endHeight == null) throw new Error('Both startFrom and endHeight must be resolved.');
  log.info(`[start] from ${startFrom} to ${endHeight} (incl.)`);

  const defaultProtoDir = new URL('../protos', import.meta.url).pathname;
  const protoDir = process.env.PROTO_DIR || defaultProtoDir;
  log.info(`[proto] dir = ${protoDir}`);

  const poolSize = cfg.decodeWorkers ?? Math.max(1, Math.min(cfg.concurrency, cpus().length));
  const decodePool = createTxDecodePool(poolSize, { protoDir });

  const sink = createSink({
    kind: cfg.sinkKind,
    outPath: cfg.outPath,
    flushEvery: cfg.flushEvery ?? 1,
    ch: cfg.ch,
    pg: cfg.pg,
    batchSizes: {
      blocks: cfg.pg?.batchBlocks,
      txs: cfg.pg?.batchTxs,
      msgs: cfg.pg?.batchMsgs,
      events: cfg.pg?.batchEvents,
      attrs: cfg.pg?.batchAttrs,
      transfers: cfg.pg?.batchTransfers,
      stakeDeleg: cfg.pg?.batchStakeDeleg,
      stakeDistr: cfg.pg?.batchStakeDistr,
      wasmExec: cfg.pg?.batchWasmExec,
      wasmEvents: cfg.pg?.batchWasmEvents,
      govDeposits: cfg.pg?.batchGovDeposits,
      govVotes: cfg.pg?.batchGovVotes,
      govProposals: cfg.pg?.batchGovProposals,
    },
  });
  await sink.init();

  const hasBackfillRange = startFrom <= endHeight;

  // Auto-detect bulk mode from durable/recovered DB state.
  let bulkMode = false;
  let bulkModeDetectionSource: 'persisted' | 'inferred' | null = null;
  if (cfg.sinkKind === 'postgres') {
    const pool = getPgPool();
    const bulkModeStatus = await detectBulkModeStatus(pool, progressId);
    bulkMode = bulkModeStatus.enabled;
    bulkModeDetectionSource = bulkModeStatus.source;
    if (bulkMode) {
      const topologyError = getBulkModeTopologyError(cfg.shards);
      if (topologyError) {
        throw new Error(topologyError);
      }

      const overlappingTables =
        bulkModeStatus.source === 'persisted' || !hasBackfillRange
          ? []
          : await findBulkModeOverlapTables(pool, startFrom, endHeight);
      const safetyError = getBulkModeSafetyError({
        detectionSource: bulkModeStatus.source,
        resumeEnabled: cfg.resume === true,
        hasBackfillRange,
        overlappingTables,
      });
      if (safetyError) {
        throw new Error(safetyError);
      }

      await disableAutovacuum(pool);
      sink.setBulkMode?.(true);
    }
  }

  activeSink = sink;
  activePool = decodePool;

  if (!hasBackfillRange) {
    log.info(`[start] no backfill needed: start ${startFrom} is above end ${endHeight}`);
  }

  const backfill = hasBackfillRange
    ? await syncRange(rpc, decodePool, sink, {
        from: startFrom,
        to: endHeight,
        concurrency: cfg.concurrency,
        progressEveryBlocks: cfg.progressEveryBlocks,
        progressIntervalSec: cfg.progressIntervalSec,
        caseMode: cfg.caseMode,
      })
    : { processed: 0 };

  log.info(
    `[done-range] ${
      hasBackfillRange ? `processed ${backfill.processed} blocks` : 'skipped backfill'
    } in [${startFrom}, ${endHeight}] — switching mode: ${cfg.follow === false ? 'exit' : 'follow'}`,
  );

  // Transition: create indexes and switch to INSERT
  if (bulkMode) {
    const pool = getPgPool();
    await sink.flush?.();
    await bulkModeOff(pool, progressId);
    sink.setBulkMode?.(false);
    log.info(
      `[bulk-mode] transition complete, switching to INSERT mode (source=${bulkModeDetectionSource ?? 'unknown'})`,
    );
  }

  if (cfg.follow !== false) {
    const pollMs = cfg.followIntervalMs ?? 1500;
    await followLoop(rpc, decodePool, sink, {
      startNext: endHeight + 1,
      pollMs,
      concurrency: cfg.concurrency,
      caseMode: cfg.caseMode,
    });
  }

  await decodePool.close();
  await sink.flush?.();
  await sink.close();
}

main().catch((e) => {
  const msg = e instanceof Error ? e.stack || e.message : String(e);
  getLogger('index').error(msg);
  process.exit(1);
});

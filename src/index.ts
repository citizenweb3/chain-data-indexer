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
import { createRpcClientFromConfig, waitForRpcStatus } from './rpc/client.ts';
import { createTxDecodePool, TxDecodePool } from './decode/txPool.ts';
import { createSink } from './sink/index.ts';
import { Sink } from './sink/types.ts';
import { closePgPool, createPgPool, getPgPool } from './db/pg.ts';
import { bulkModeOn, bulkModeOff, recoverDerived } from './db/bulk-mode.ts';
import { getProgress } from './db/progress.ts';
import { getLogger } from './utils/logger.ts';
import { syncRange } from './runner/syncRange.ts';
import { followLoop } from './runner/follow.ts';

EventEmitter.defaultMaxListeners = 0;
const log = getLogger('index');

let activeSink: Sink | null = null;
let activePool: TxDecodePool | null = null;
let shuttingDown = false;

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

  const rpc = createRpcClientFromConfig(cfg);
  const status = await waitForRpcStatus(rpc, { label: 'startup' });

  let startFrom = cfg.from as number | undefined;
  const wantResume =
    !startFrom || cfg.resume === true || (typeof cfg.from === 'string' && cfg.from.toLowerCase() === 'resume');

  if (wantResume) {
    if (cfg.sinkKind === 'postgres') {
      const pool = createPgPool({ ...cfg.pg, applicationName: 'cosmos-indexer-resolver' });
      try {
        const last = await getProgress(pool, cfg.pg?.progressId ?? 'default');
        const earliest = Number(status['sync_info']['earliest_block_height']);
        const explicitFrom = typeof cfg.from === 'number' ? cfg.from : (cfg.firstBlock as number | undefined);
        startFrom = last != null ? last + 1 : (explicitFrom ?? earliest);
        log.info(`[resume] last_height=${last ?? 'null'} → start from ${startFrom}`);
      } finally {
        await closePgPool();
      }
    } else {
      log.warn('[resume] requested, but sinkKind is not postgres — skipping.');
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

  if (cfg.pg?.bulkMode && cfg.sinkKind === 'postgres') {
    const pool = getPgPool();
    await recoverDerived(pool);
    await bulkModeOn(pool);
  }

  activeSink = sink;
  activePool = decodePool;

  const backfill = await syncRange(rpc, decodePool, sink, {
    from: startFrom,
    to: endHeight,
    concurrency: cfg.concurrency,
    progressEveryBlocks: cfg.progressEveryBlocks,
    progressIntervalSec: cfg.progressIntervalSec,
    caseMode: cfg.caseMode,
  });

  log.info(
    `[done-range] processed ${backfill.processed} blocks in [${startFrom}, ${endHeight}] — switching mode: ${
      cfg.follow === false ? 'exit' : 'follow'
    }`,
  );

  if (cfg.follow !== false) {
    const pollMs = cfg.followIntervalMs ?? 1500;
    await followLoop(rpc, decodePool, sink, {
      startNext: endHeight + 1,
      pollMs,
      concurrency: cfg.concurrency,
      caseMode: cfg.caseMode,
      bulkMode: cfg.pg?.bulkMode,
    });
  } else if (cfg.pg?.bulkMode && cfg.sinkKind === 'postgres') {
    // FOLLOW=false: restore indexes before exit, otherwise DB is left without them
    await sink.flush?.();
    (sink as any).setBulkMode?.(false);
    await bulkModeOff(getPgPool());
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

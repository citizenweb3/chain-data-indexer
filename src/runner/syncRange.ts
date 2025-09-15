// src/runner/syncRange.ts
/**
 * Orchestrates range-based block synchronization:
 * fetches blocks and block results from RPC, decodes transactions in a worker pool,
 * assembles a normalized block JSON, and streams results into the configured sink
 * while preserving block order and reporting progress.
 */
import { assembleBlockJsonFromParts } from '../assemble/blockJson.ts';
import { formatDuration } from '../utils/time.ts';
import { getLogger } from '../utils/logger.ts';
import { createRpcClientFromConfig } from '../rpc/client.ts';
import { createTxDecodePool } from '../decode/txPool.ts';
import { createSink } from '../sink/index.ts';

const log = getLogger('runner/syncRange');

/**
 * Output field casing for assembled JSON objects.
 * - `'camel'` — convert fields to camelCase
 * - `'snake'` — convert fields to snake_case
 * @property {boolean} [reportSpeed=true] Include rate and ETA in progress logs.
 */
export type CaseMode = 'camel' | 'snake';

/**
 * Options controlling range synchronization behavior.
 * @property {number} from Inclusive starting height of the range.
 * @property {number} to Inclusive ending height of the range.
 * @property {number} concurrency Maximum number of in-flight heights (sliding window).
 * @property {number} progressEveryBlocks Emit a progress line every N processed blocks.
 * @property {number} progressIntervalSec Emit a progress line if this many seconds passed since last report.
 * @property {CaseMode} caseMode Field casing for assembled output objects.
 * @property {number} [blockTimeoutMs=30000] Per-height timeout in milliseconds for fetch/decode/assemble steps.
 * @property {number} [maxBlockRetries=3] Maximum retry attempts per height before we skip it.
 * @property {boolean} [reportSpeed=true] Include rate and ETA in progress logs.
 */
export interface SyncRangeOptions {
  from: number;
  to: number;
  concurrency: number;
  progressEveryBlocks: number;
  progressIntervalSec: number;
  caseMode: CaseMode;
  /** Per-height operation timeout in milliseconds (fetch/decoding/assembly). Defaults to 30000. */
  blockTimeoutMs?: number;
  /** Maximum retry attempts per height before giving up. Defaults to 3. */
  maxBlockRetries?: number;
  /** If true, include rate/ETA in progress logs. Defaults to true. */
  reportSpeed?: boolean;
}

/**
 * Wraps a promise with a timeout that rejects with a labeled error if exceeded.
 * @template T
 * @param {Promise<T>} p The promise to await.
 * @param {number} ms Timeout in milliseconds.
 * @param {string} label Human-readable label for diagnostics (included in the error message).
 * @returns {Promise<T>} Resolves with the original promise result or rejects on timeout.
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new Error(`timeout: ${label} after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

/**
 * Synchronizes a contiguous height range with controlled concurrency, retries and ordered flushing.
 *
 * Internals:
 * - Spawns up to `concurrency` in-flight heights;
 * - Retries failed heights up to `maxBlockRetries`, queuing them in `retryQueue`;
 * - Maintains an in-memory `ready` buffer keyed by height to flush in-order;
 * - Periodically reports progress and ETA.
 *
 * @param {ReturnType<typeof createRpcClientFromConfig>} rpc RPC client used to fetch blocks and results.
 * @param {ReturnType<typeof createTxDecodePool>} pool Worker pool that decodes base64 transactions.
 * @param {ReturnType<typeof createSink>} sink Destination writer that persists assembled blocks.
 * @param {SyncRangeOptions} opts Range and tuning options.
 * @returns {Promise<{ processed: number }>} Number of processed heights within the range.
 */
export async function syncRange(
  rpc: ReturnType<typeof createRpcClientFromConfig>,
  pool: ReturnType<typeof createTxDecodePool>,
  sink: ReturnType<typeof createSink>,
  opts: SyncRangeOptions,
): Promise<{ processed: number }> {
  const {
    from,
    to,
    concurrency,
    progressEveryBlocks,
    progressIntervalSec,
    caseMode,
    blockTimeoutMs = 30_000,
    maxBlockRetries = 3,
    reportSpeed = true,
  } = opts;

  const totalBlocks = to - from + 1;
  let processed = 0;
  const t0 = Date.now();
  let lastLogAt = t0;

  /**
   * Emits a progress log line either on schedule (by block count or time) or when forced.
   * @param {boolean} [force=false] If true, logs regardless of counters/timers.
   * @param {number} [h=0] The last height we touched (for context).
   * @param {number} [inFlight=0] Currently in-flight heights.
   * @param {number} [retryQ=0] Pending heights in retry queue.
   * @param {number} [nextH=0] Next height planned to spawn.
   * @returns {void}
   */
  function maybeReportProgress(force = false, h = 0, inFlight = 0, retryQ = 0, nextH = 0) {
    const now = Date.now();
    const elapsedSec = (now - t0) / 1000;
    const sinceLastSec = (now - lastLogAt) / 1000;
    const rate = processed > 0 && elapsedSec > 0 ? processed / elapsedSec : 0;
    const remaining = Math.max(0, totalBlocks - processed);
    const etaSec = rate > 0 ? remaining / rate : Infinity;
    const needByCount = processed > 0 && processed % progressEveryBlocks === 0;
    const needByTime = sinceLastSec >= progressIntervalSec;
    if (reportSpeed && (force || needByCount || needByTime)) {
      let msg = `[progress] ${processed}/${totalBlocks} blocks | currentHeight ${h} | elapsed ${formatDuration(
        elapsedSec,
      )}`;
      if (rate > 0) {
        msg += ` | rate ${rate.toFixed(1)} blk/s | ETA ${formatDuration(etaSec)}`;
      }
      msg += ` | inFlight=${inFlight} retryQ=${retryQ} next=${nextH}`;
      log.info(msg);
      lastLogAt = now;
    }
  }

  const ready = new Map<number, unknown>();
  let nextToFlush = from;

  /**
   * Flushes consecutive ready heights to the sink in order, starting from `nextToFlush`.
   * Skips special placeholders (objects that contain `__skip` or an `error` field),
   * but still advances progress counters so the pipeline keeps moving.
   * @param {number} h Height that triggered the flush attempt (for logging context).
   * @returns {Promise<void>}
   */
  async function tryFlush(h: number) {
    let flushed = 0;
    while (ready.has(nextToFlush)) {
      const obj = ready.get(nextToFlush)! as any;
      ready.delete(nextToFlush);
      if (
        obj &&
        typeof obj === 'object' &&
        (obj.__skip === true || Object.prototype.hasOwnProperty.call(obj, 'error'))
      ) {
        nextToFlush++;
        flushed++;
        processed++;
        continue;
      }
      await sink.write(obj as any);
      nextToFlush++;
      flushed++;
      processed++;
    }
    if (flushed > 0) maybeReportProgress(false, h, inFlight, retryQueue.length, nextHeight);
  }

  const attempts = new Map<number, number>();
  const retryQueue: number[] = [];

  /**
   * Fetches, decodes and assembles a single height, handling timeouts and retries.
   * On success, places the assembled object into the `ready` buffer.
   * On repeated failures beyond `maxBlockRetries`, places a skip marker.
   * @param {number} h Target height to process.
   * @returns {Promise<void>}
   */
  async function processHeight(h: number) {
    try {
      const [b, br] = await Promise.all([
        withTimeout(rpc.fetchBlock(h), blockTimeoutMs, `fetchBlock@${h}`),
        withTimeout(rpc.fetchBlockResults(h), blockTimeoutMs, `fetchBlockResults@${h}`),
      ]);
      const txsB64: string[] = b?.block?.data?.txs ?? [];
      const decoded = await Promise.all(
        txsB64.map((x, i) => withTimeout(pool.submit(x), blockTimeoutMs, `decode#${i}@${h}`)),
      );
      const assembled = await withTimeout(
        assembleBlockJsonFromParts(rpc, b, br, decoded, caseMode),
        blockTimeoutMs,
        `assemble@${h}`,
      );
      ready.set(h, assembled);
    } catch (e: any) {
      const n = (attempts.get(h) ?? 0) + 1;
      attempts.set(h, n);
      if (n <= maxBlockRetries) {
        retryQueue.push(h);
        log.warn(`retry ${n}/${maxBlockRetries} for height ${h}: ${String(e?.message ?? e)}`);
      } else {
        ready.set(h, { __skip: true, height: h, error: String(e?.message ?? e) });
        log.error(`giving up height ${h}: ${String(e?.message ?? e)}`);
      }
    } finally {
      await tryFlush(h);
    }
  }

  let nextHeight = from;
  let inFlight = 0;

  await new Promise<void>((resolve) => {
    const maybeSpawn = () => {
      while (inFlight < concurrency && (nextHeight <= to || retryQueue.length > 0)) {
        const h = retryQueue.length > 0 ? (retryQueue.shift() as number) : nextHeight++;
        inFlight++;
        processHeight(h).finally(() => {
          inFlight--;
          if (nextHeight > to && retryQueue.length === 0 && inFlight === 0) {
            resolve();
          } else {
            setImmediate(maybeSpawn);
          }
        });
      }
      maybeReportProgress(false, nextHeight - 1, inFlight, retryQueue.length, nextHeight);
    };
    maybeSpawn();
  });

  maybeReportProgress(true, to, 0, 0, nextHeight);
  return { processed };
}

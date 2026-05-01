import type pg from 'pg';
import { config } from '../config.js';
import { getPool, getPoolStats } from '../db/pg.js';
import type { MidenRpcClient } from '../rpc/client.js';
import { logger } from '../utils/logger.js';
import { setChainTipHeight, setIndexedHeight, setPgPoolStats } from './registry.js';

interface ProgressRow {
  last_block: string | null;
}

let timer: NodeJS.Timeout | null = null;
let inFlight = false;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timeout.unref();
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timeout);
        reject(err);
      },
    );
  });
}

function chainTipFromStatus(
  status: Awaited<ReturnType<MidenRpcClient['status']>>,
): number | null {
  return status.store?.chainTip ?? status.blockProducer?.chainTip ?? null;
}

async function sampleOnce(rpc: MidenRpcClient, pool: pg.Pool): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const stats = getPoolStats();
    setPgPoolStats(stats.active, stats.idle, stats.waiting);

    const [statusResult, progressResult] = await Promise.all([
      withTimeout(rpc.status(), 4_000, 'Metrics tip sampling').catch((err: unknown) => {
        logger.debug('Metrics tip sampling failed', { err });
        return null;
      }),
      withTimeout(
        pool
          .query<ProgressRow>('SELECT last_block::text FROM miden_indexer_progress WHERE id = 1')
          .then((result) => result.rows[0]?.last_block ?? null),
        4_000,
        'Metrics indexed height sampling',
      ).catch((err: unknown) => {
        logger.debug('Metrics indexed height sampling failed', { err });
        return null;
      }),
    ]);

    if (statusResult) {
      const tip = chainTipFromStatus(statusResult);
      if (tip !== null) setChainTipHeight(tip);
    }
    if (progressResult !== null) setIndexedHeight(Number(progressResult));
  } finally {
    inFlight = false;
  }
}

export function startMetricsSampler(rpc: MidenRpcClient, pool: pg.Pool = getPool()): () => void {
  if (!config.METRICS_ENABLED) return () => undefined;
  if (timer) return stopMetricsSampler;

  void sampleOnce(rpc, pool);
  timer = setInterval(() => { void sampleOnce(rpc, pool); }, config.METRICS_SAMPLE_INTERVAL_MS);
  timer.unref();
  return stopMetricsSampler;
}

export function stopMetricsSampler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

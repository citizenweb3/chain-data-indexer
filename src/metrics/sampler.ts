import { config } from '../config.js';
import { getPool, getPoolStats } from '../db/pg.js';
import { getProgress } from '../db/progress.js';
import { fetchInfo } from '../rpc/client.js';
import { logger } from '../utils/logger.js';
import {
  setChainTipHeight,
  setIndexedHeight,
  setNodeSyncState,
  setPgPoolStats,
  setSupplyCheckpointHeight,
} from './registry.js';

interface SupplyHeightRow {
  height: string | null;
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

async function sampleOnce(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const stats = getPoolStats();
    setPgPoolStats(stats.active, stats.idle, stats.waiting);

    const [info, progress, supplyHeight] = await Promise.all([
      fetchInfo(4_000, 1).catch((err: unknown) => {
        logger.debug('Metrics tip sampling failed', { err });
        return null;
      }),
      withTimeout(getProgress(), 4_000, 'Metrics progress sampling').catch((err: unknown) => {
        logger.debug('Metrics progress sampling failed', { err });
        return null;
      }),
      withTimeout(
        getPool()
          .query<SupplyHeightRow>('SELECT MAX(height)::text AS height FROM monero_supply_checkpoints')
          .then((result) => result.rows[0]?.height ?? null),
        4_000,
        'Metrics supply sampling',
      ).catch((err: unknown) => {
        logger.debug('Metrics supply sampling failed', { err });
        return null;
      }),
    ]);

    if (info) {
      setChainTipHeight(info.height);
      setNodeSyncState(info.busy_syncing || !info.synchronized);
    }
    if (progress) setIndexedHeight(progress.lastHeight);
    if (supplyHeight !== null) setSupplyCheckpointHeight(Number(supplyHeight));
  } finally {
    inFlight = false;
  }
}

export function startMetricsSampler(): () => void {
  if (!config.METRICS_ENABLED) return () => undefined;
  if (timer) return stopMetricsSampler;

  void sampleOnce();
  timer = setInterval(() => { void sampleOnce(); }, config.METRICS_SAMPLE_INTERVAL_MS);
  timer.unref();
  return stopMetricsSampler;
}

export function stopMetricsSampler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

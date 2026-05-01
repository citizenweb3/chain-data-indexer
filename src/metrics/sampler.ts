import { config } from '../config.js';
import { getPool, getPoolStats } from '../db/pg.js';
import { fetchInfo } from '../rpc/client.js';
import { logger } from '../utils/logger.js';
import { setChainTipHeight, setIndexedHeight, setPgPoolStats } from './registry.js';

interface HeightRow {
  last_height: string | null;
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

    const [info, progress] = await Promise.all([
      fetchInfo(4_000, 1).catch((err: unknown) => {
        logger.debug('Metrics tip sampling failed', { err });
        return null;
      }),
      withTimeout(
        getPool()
          .query<HeightRow>("SELECT last_height::text FROM logos_indexer_progress WHERE id = 'default'")
          .then((result) => result.rows[0]?.last_height ?? null),
        4_000,
        'Metrics indexed height sampling',
      ).catch((err: unknown) => {
        logger.debug('Metrics indexed height sampling failed', { err });
        return null;
      }),
    ]);

    if (info) setChainTipHeight(info.height);
    if (progress !== null) setIndexedHeight(Number(progress));
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

/**
 * @module metrics/registry
 *
 * Prometheus metrics registry for the indexer. Exposes a singleton `Registry`
 * with all `cdi_*` metric definitions plus thin helper functions used from
 * hot paths (RPC client, sink flushers, runners, sampler).
 *
 * Hot-path helpers must stay allocation-free and never throw — observability
 * code must not affect indexing correctness.
 *
 * Default Node.js process metrics (CPU, RSS, GC, event loop lag) are
 * registered via `collectDefaultMetrics()` on the same registry.
 */
import {
  Registry,
  Counter,
  Gauge,
  Histogram,
  collectDefaultMetrics,
  type LabelValues,
} from 'prom-client';

export const registry = new Registry();
registry.setDefaultLabels({ app: 'cosmos-indexer' });
collectDefaultMetrics({ register: registry, prefix: 'cdi_node_' });

// ── Pipeline progress ────────────────────────────────────────────────────────

export const indexedHeight = new Gauge({
  name: 'cdi_indexed_height',
  help: 'Last persisted block height (max committed by the sink).',
  registers: [registry],
});

export const chainTipHeight = new Gauge({
  name: 'cdi_chain_tip_height',
  help: 'Latest block height reported by the upstream RPC node (sampled).',
  registers: [registry],
});

export const lagBlocks = new Gauge({
  name: 'cdi_lag_blocks',
  help: 'chain_tip_height - indexed_height (0 until tip is sampled).',
  registers: [registry],
});

export const blocksProcessed = new Counter({
  name: 'cdi_blocks_processed_total',
  help: 'Total number of blocks successfully assembled and handed to the sink.',
  registers: [registry],
});

export const blockProcessDuration = new Histogram({
  name: 'cdi_block_process_duration_seconds',
  help: 'End-to-end per-block latency: fetch + decode + assemble + flush share.',
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
  registers: [registry],
});

// ── Sink flush instrumentation ───────────────────────────────────────────────

export const flushDuration = new Histogram({
  name: 'cdi_flush_duration_seconds',
  help: 'Duration of a sink flush transaction, broken down by table group.',
  labelNames: ['group'] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300],
  registers: [registry],
});

export const flushRows = new Counter({
  name: 'cdi_flush_rows_total',
  help: 'Total rows committed to the sink, broken down by table.',
  labelNames: ['table'] as const,
  registers: [registry],
});

// ── RPC instrumentation ──────────────────────────────────────────────────────

export const rpcRequests = new Counter({
  name: 'cdi_rpc_requests_total',
  help: 'Total RPC requests (terminal outcome only — retries collapsed into the final status).',
  labelNames: ['endpoint', 'status'] as const,
  registers: [registry],
});

export const rpcRequestDuration = new Histogram({
  name: 'cdi_rpc_request_duration_seconds',
  help: 'RPC request duration measured from start to terminal outcome.',
  labelNames: ['endpoint'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
  registers: [registry],
});

export const rpcOutageState = new Gauge({
  name: 'cdi_rpc_outage_state',
  help: '1 when RPC is currently considered unreachable, 0 otherwise.',
  registers: [registry],
});

// ── Decode pool ──────────────────────────────────────────────────────────────

export const decodePoolBusy = new Gauge({
  name: 'cdi_decode_pool_busy',
  help: 'Number of decode workers currently processing a transaction.',
  registers: [registry],
});

export const decodePoolSize = new Gauge({
  name: 'cdi_decode_pool_size',
  help: 'Total number of decode workers in the pool.',
  registers: [registry],
});

// ── Postgres pool ────────────────────────────────────────────────────────────

export const pgPoolActive = new Gauge({
  name: 'cdi_pg_pool_active',
  help: 'Postgres connections currently checked out from the pool.',
  registers: [registry],
});

export const pgPoolIdle = new Gauge({
  name: 'cdi_pg_pool_idle',
  help: 'Postgres connections currently idle in the pool.',
  registers: [registry],
});

export const pgPoolWaiting = new Gauge({
  name: 'cdi_pg_pool_waiting',
  help: 'Pending requests waiting for a Postgres connection.',
  registers: [registry],
});

// ── Mode / phase ─────────────────────────────────────────────────────────────

export const bulkModeGauge = new Gauge({
  name: 'cdi_bulk_mode',
  help: '1 when bulk-ingest mode is active (UNLOGGED partitions, indexes dropped), 0 otherwise.',
  registers: [registry],
});

export const phaseInfo = new Gauge({
  name: 'cdi_phase_info',
  help: 'Indicator of the current pipeline phase (single label set is 1, others 0).',
  labelNames: ['phase'] as const,
  registers: [registry],
});

const PHASES = ['starting', 'backfill', 'follow', 'shutdown'] as const;
type Phase = (typeof PHASES)[number];

// ── Helpers (hot paths) ──────────────────────────────────────────────────────

let lastTip = 0;
let lastIndexed = 0;

function recomputeLag(): void {
  if (lastTip > 0) lagBlocks.set(Math.max(0, lastTip - lastIndexed));
}

export function setIndexedHeight(h: number): void {
  lastIndexed = h;
  indexedHeight.set(h);
  recomputeLag();
}

export function setChainTipHeight(h: number): void {
  lastTip = h;
  chainTipHeight.set(h);
  recomputeLag();
}

export function observeBlock(durationSec: number): void {
  blocksProcessed.inc(1);
  blockProcessDuration.observe(durationSec);
}

export function observeFlush(group: string, durationSec: number, rowsByTable?: Record<string, number>): void {
  flushDuration.observe({ group } as LabelValues<'group'>, durationSec);
  if (!rowsByTable) return;
  for (const [table, n] of Object.entries(rowsByTable)) {
    if (n > 0) flushRows.inc({ table } as LabelValues<'table'>, n);
  }
}

export function observeRpc(endpoint: string, status: 'ok' | 'error' | 'timeout', durationSec: number): void {
  rpcRequests.inc({ endpoint, status } as LabelValues<'endpoint' | 'status'>, 1);
  rpcRequestDuration.observe({ endpoint } as LabelValues<'endpoint'>, durationSec);
}

export function setRpcOutage(down: boolean): void {
  rpcOutageState.set(down ? 1 : 0);
}

export function setDecodePool(busy: number, size: number): void {
  decodePoolBusy.set(busy);
  decodePoolSize.set(size);
}

export function setPgPoolStats(active: number, idle: number, waiting: number): void {
  pgPoolActive.set(active);
  pgPoolIdle.set(idle);
  pgPoolWaiting.set(waiting);
}

export function setBulkModeMetric(on: boolean): void {
  bulkModeGauge.set(on ? 1 : 0);
}

export function setPhaseMetric(phase: Phase): void {
  for (const p of PHASES) {
    phaseInfo.set({ phase: p } as LabelValues<'phase'>, p === phase ? 1 : 0);
  }
}

/**
 * Returns the Prometheus text exposition for all registered metrics.
 */
export async function renderMetrics(): Promise<string> {
  return registry.metrics();
}

export const METRICS_CONTENT_TYPE = registry.contentType;

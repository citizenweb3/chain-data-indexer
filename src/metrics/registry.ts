import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client';

export const registry = new Registry();

collectDefaultMetrics({
  register: registry,
  prefix: 'monero_node_',
});

const indexedHeightGauge = new Gauge({
  name: 'monero_indexed_height',
  help: 'Last indexed Monero block height committed to storage.',
  registers: [registry],
});

const chainTipHeightGauge = new Gauge({
  name: 'monero_chain_tip_height',
  help: 'Latest chain height sampled from monerod.',
  registers: [registry],
});

const lagBlocksGauge = new Gauge({
  name: 'monero_lag_blocks',
  help: 'Difference between sampled chain tip height and indexed height.',
  registers: [registry],
});

const supplyCheckpointHeightGauge = new Gauge({
  name: 'monero_supply_checkpoint_height',
  help: 'Latest Monero supply checkpoint height written to storage.',
  registers: [registry],
});

const supplyLagBlocksGauge = new Gauge({
  name: 'monero_supply_lag_blocks',
  help: 'Difference between sampled chain tip height and latest supply checkpoint height.',
  registers: [registry],
});

const nodeSyncStateGauge = new Gauge({
  name: 'monero_node_syncing_state',
  help: '1 when monerod is syncing or not yet synchronized, 0 when it is fully synchronized.',
  registers: [registry],
});

const blocksProcessedTotal = new Counter({
  name: 'monero_blocks_processed_total',
  help: 'Total newly indexed Monero blocks committed to storage.',
  registers: [registry],
});

const blockProcessDurationSeconds = new Histogram({
  name: 'monero_block_process_duration_seconds',
  help: 'Duration of successful Monero block processing operations in seconds.',
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [registry],
});

const flushDurationSeconds = new Histogram({
  name: 'monero_flush_duration_seconds',
  help: 'Duration of database flush operations in seconds.',
  labelNames: ['group'] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [registry],
});

const flushRowsTotal = new Counter({
  name: 'monero_flush_rows_total',
  help: 'Rows written by database flush operations.',
  labelNames: ['table'] as const,
  registers: [registry],
});

const rpcRequestsTotal = new Counter({
  name: 'monero_rpc_requests_total',
  help: 'Total Monero RPC requests by endpoint and final status.',
  labelNames: ['endpoint', 'status'] as const,
  registers: [registry],
});

const rpcRequestDurationSeconds = new Histogram({
  name: 'monero_rpc_request_duration_seconds',
  help: 'Duration of Monero RPC requests in seconds.',
  labelNames: ['endpoint'] as const,
  buckets: [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 300],
  registers: [registry],
});

const rpcOutageState = new Gauge({
  name: 'monero_rpc_outage_state',
  help: 'Monero RPC outage state: 1 when the latest RPC request failed, 0 after success.',
  registers: [registry],
});

const pgPoolActive = new Gauge({
  name: 'monero_pg_pool_active',
  help: 'Active PostgreSQL pool clients.',
  registers: [registry],
});

const pgPoolIdle = new Gauge({
  name: 'monero_pg_pool_idle',
  help: 'Idle PostgreSQL pool clients.',
  registers: [registry],
});

const pgPoolWaiting = new Gauge({
  name: 'monero_pg_pool_waiting',
  help: 'Waiting PostgreSQL pool requests.',
  registers: [registry],
});

const PHASES = ['starting', 'backfill', 'follow', 'shutdown'] as const;
type Phase = typeof PHASES[number];

const phaseInfo = new Gauge({
  name: 'monero_phase_info',
  help: 'Active Monero indexer phase; value is 1 only for the active phase.',
  labelNames: ['phase'] as const,
  registers: [registry],
});

type RpcStatus = 'ok' | 'timeout' | 'error';
type FlushGroup = 'core' | 'derived' | 'progress' | 'supply';
type FlushTable =
  | 'monero_blocks'
  | 'monero_transactions'
  | 'monero_indexer_progress'
  | 'monero_supply_checkpoints';

type FlushRows = Partial<Record<FlushTable, number>>;

let indexedHeight: number | null = null;
let chainTipHeight: number | null = null;
let supplyCheckpointHeight: number | null = null;

const FLUSH_GROUPS: FlushGroup[] = ['core', 'derived', 'progress', 'supply'];
const FLUSH_TABLES: FlushTable[] = [
  'monero_blocks',
  'monero_transactions',
  'monero_indexer_progress',
  'monero_supply_checkpoints',
];
const RPC_ENDPOINTS = [
  'json_rpc:get_info',
  'json_rpc:get_block_count',
  'json_rpc:get_block',
  'json_rpc:get_block_header_by_height',
  'json_rpc:get_coinbase_tx_sum',
  'json_rpc:prune_blockchain',
  'json_rpc:get_alternate_chains',
  'json_rpc:sync_info',
  'path:/get_transactions',
] as const;
const RPC_STATUSES: RpcStatus[] = ['ok', 'timeout', 'error'];

for (const group of FLUSH_GROUPS) flushDurationSeconds.labels(group);
for (const table of FLUSH_TABLES) flushRowsTotal.labels(table).inc(0);
for (const endpoint of RPC_ENDPOINTS) {
  rpcRequestDurationSeconds.labels(endpoint);
  for (const status of RPC_STATUSES) rpcRequestsTotal.labels(endpoint, status).inc(0);
}
for (const phase of PHASES) phaseInfo.labels(phase).set(0);

function isUsableNumber(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function updateLag(): void {
  if (chainTipHeight === null || indexedHeight === null) {
    lagBlocksGauge.set(0);
  } else {
    lagBlocksGauge.set(Math.max(0, chainTipHeight - indexedHeight));
  }

  if (chainTipHeight === null || supplyCheckpointHeight === null) {
    supplyLagBlocksGauge.set(0);
  } else {
    supplyLagBlocksGauge.set(Math.max(0, chainTipHeight - supplyCheckpointHeight));
  }
}

export function setIndexedHeight(height: number | null | undefined): void {
  if (height == null || !isUsableNumber(height)) return;
  indexedHeight = height;
  indexedHeightGauge.set(height);
  updateLag();
}

export function setChainTipHeight(height: number | null | undefined): void {
  if (height == null || !isUsableNumber(height)) return;
  chainTipHeight = height;
  chainTipHeightGauge.set(height);
  updateLag();
}

export function setSupplyCheckpointHeight(height: number | null | undefined): void {
  if (height == null || !isUsableNumber(height)) return;
  supplyCheckpointHeight = height;
  supplyCheckpointHeightGauge.set(height);
  updateLag();
}

export function setNodeSyncState(syncing: boolean): void {
  nodeSyncStateGauge.set(syncing ? 1 : 0);
}

export function observeBlock(durationSeconds: number, count = 1): void {
  if (!isUsableNumber(durationSeconds) || count <= 0) return;
  blocksProcessedTotal.inc(count);
  blockProcessDurationSeconds.observe(durationSeconds);
}

export function observeFlush(
  group: FlushGroup,
  durationSeconds: number,
  rowCounts: FlushRows = {},
): void {
  if (isUsableNumber(durationSeconds)) {
    flushDurationSeconds.labels(group).observe(durationSeconds);
  }
  for (const [table, count] of Object.entries(rowCounts) as [FlushTable, number][]) {
    if (count > 0) flushRowsTotal.labels(table).inc(count);
  }
}

export function observeRpc(
  endpoint: string,
  status: RpcStatus,
  durationSeconds: number,
): void {
  rpcRequestsTotal.labels(endpoint, status).inc();
  if (isUsableNumber(durationSeconds)) {
    rpcRequestDurationSeconds.labels(endpoint).observe(durationSeconds);
  }
  setRpcOutage(status === 'ok' ? 0 : 1);
}

export function setRpcOutage(value: 0 | 1): void {
  rpcOutageState.set(value);
}

export function setPgPoolStats(active: number, idle: number, waiting: number): void {
  pgPoolActive.set(active);
  pgPoolIdle.set(idle);
  pgPoolWaiting.set(waiting);
}

export function setPhase(phase: Phase): void {
  for (const knownPhase of PHASES) {
    phaseInfo.labels(knownPhase).set(knownPhase === phase ? 1 : 0);
  }
}

export async function metricsText(): Promise<string> {
  return registry.metrics();
}

export const metricsContentType = registry.contentType;

import {
  Counter,
  Gauge,
  Histogram,
  MetricsRegistry,
  createRegistry,
  startNodeDefaultMetrics,
} from "@chicmoz-pkg/metrics-server";

export const PREFIX = "aztec_listener";
export const metrics: MetricsRegistry = createRegistry(PREFIX);
startNodeDefaultMetrics(metrics);

const r = metrics.registry;

// ---- Heights / lag ----
const indexedProposed = new Gauge({
  name: `${PREFIX}_indexed_proposed_height`,
  help: "Latest L2 proposed block height processed by the listener",
  registers: [r],
});
const indexedProven = new Gauge({
  name: `${PREFIX}_indexed_proven_height`,
  help: "Latest L2 proven block height processed by the listener",
  registers: [r],
});
const chainProposed = new Gauge({
  name: `${PREFIX}_chain_proposed_tip_height`,
  help: "Latest L2 proposed block height seen on chain",
  registers: [r],
});
const chainProven = new Gauge({
  name: `${PREFIX}_chain_proven_tip_height`,
  help: "Latest L2 proven block height seen on chain",
  registers: [r],
});
const lagProposed = new Gauge({
  name: `${PREFIX}_lag_proposed_blocks`,
  help: "chain proposed tip - indexed proposed (capped at 0)",
  registers: [r],
});
const lagProven = new Gauge({
  name: `${PREFIX}_lag_proven_blocks`,
  help: "chain proven tip - indexed proven (capped at 0)",
  registers: [r],
});

const recomputeLag = () => {
  lagProposed.set(Math.max(0, lastChainProposed - lastIndexedProposed));
  lagProven.set(Math.max(0, lastChainProven - lastIndexedProven));
};

let lastIndexedProposed = 0;
let lastIndexedProven = 0;
let lastChainProposed = 0;
let lastChainProven = 0;

export const setIndexedProposedHeight = (h: number) => {
  lastIndexedProposed = h;
  indexedProposed.set(h);
  recomputeLag();
};
export const setIndexedProvenHeight = (h: number) => {
  lastIndexedProven = h;
  indexedProven.set(h);
  recomputeLag();
};
export const setChainProposedTip = (h: number) => {
  lastChainProposed = h;
  chainProposed.set(h);
  recomputeLag();
};
export const setChainProvenTip = (h: number) => {
  lastChainProven = h;
  chainProven.set(h);
  recomputeLag();
};

// ---- Block processing ----
export type BlockStatus =
  | "proposed"
  | "proven"
  | "catchup_proposed"
  | "catchup_proven";
const blocksProcessed = new Counter({
  name: `${PREFIX}_blocks_processed_total`,
  help: "Total blocks processed by status",
  labelNames: ["status"] as const,
  registers: [r],
});
const blockProcessDuration = new Histogram({
  name: `${PREFIX}_block_process_duration_seconds`,
  help: "Wall time spent processing a single block",
  labelNames: ["status"] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
  registers: [r],
});
const blockFetchDuration = new Histogram({
  name: `${PREFIX}_block_fetch_duration_seconds`,
  help: "Time spent fetching a block from the worker pool",
  labelNames: ["cache"] as const,
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [r],
});

export const observeBlock = (status: BlockStatus, durationSec: number) => {
  blocksProcessed.inc({ status });
  blockProcessDuration.observe({ status }, durationSec);
};
export const observeBlockFetch = (cache: "hit" | "miss", durationSec: number) => {
  blockFetchDuration.observe({ cache }, durationSec);
};

// ---- Worker pool stats (sampled) ----
const fetcherQueue = new Gauge({
  name: `${PREFIX}_block_fetcher_queue_size`,
  help: "Pending requests in the block-fetcher worker pool",
  registers: [r],
});
const fetcherActive = new Gauge({
  name: `${PREFIX}_block_fetcher_active_workers`,
  help: "Active workers currently fetching blocks",
  registers: [r],
});
const fetcherCache = new Gauge({
  name: `${PREFIX}_block_fetcher_cache_size`,
  help: "Pre-fetched blocks held in the worker-pool cache",
  registers: [r],
});
export const setFetcherStats = (s: {
  queue: number;
  active: number;
  cache: number;
}) => {
  fetcherQueue.set(s.queue);
  fetcherActive.set(s.active);
  fetcherCache.set(s.cache);
};

// ---- Batch flush ----
const flushDuration = new Histogram({
  name: `${PREFIX}_batch_flush_duration_seconds`,
  help: "Duration of a batched DB flush",
  labelNames: ["group"] as const,
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [r],
});
const flushRows = new Counter({
  name: `${PREFIX}_batch_flush_rows_total`,
  help: "Rows written by batched flushes, by table",
  labelNames: ["table"] as const,
  registers: [r],
});
export const observeFlush = (
  group: string,
  durationSec: number,
  rowCounts: Record<string, number> = {},
) => {
  flushDuration.observe({ group }, durationSec);
  for (const [table, n] of Object.entries(rowCounts)) {
    if (n > 0) flushRows.inc({ table }, n);
  }
};

// ---- RPC ----
export type RpcStatus = "ok" | "error" | "timeout";
const rpcRequests = new Counter({
  name: `${PREFIX}_rpc_requests_total`,
  help: "RPC requests to Aztec nodes by node, endpoint, status",
  labelNames: ["node", "endpoint", "status"] as const,
  registers: [r],
});
const rpcDuration = new Histogram({
  name: `${PREFIX}_rpc_request_duration_seconds`,
  help: "RPC request duration by endpoint",
  labelNames: ["endpoint"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [r],
});
const rpcNodesOnline = new Gauge({
  name: `${PREFIX}_rpc_nodes_online`,
  help: "Number of Aztec RPC nodes currently online in the pool",
  registers: [r],
});
const rpcOutage = new Gauge({
  name: `${PREFIX}_rpc_outage_state`,
  help: "1 when all RPC nodes are offline, otherwise 0",
  registers: [r],
});
export const observeRpc = (
  node: string,
  endpoint: string,
  status: RpcStatus,
  durationSec: number,
) => {
  rpcRequests.inc({ node, endpoint, status });
  rpcDuration.observe({ endpoint }, durationSec);
};
export const setRpcNodesOnline = (n: number) => {
  rpcNodesOnline.set(n);
  rpcOutage.set(n === 0 ? 1 : 0);
};

// ---- Message bus (publish) ----
const busPublished = new Counter({
  name: `${PREFIX}_message_bus_published_total`,
  help: "Messages published to Kafka by topic and status",
  labelNames: ["topic", "status"] as const,
  registers: [r],
});
export const observeBusPublish = (topic: string, status: "ok" | "error") => {
  busPublished.inc({ topic, status });
};

// ---- Phase ----
export type Phase = "catchup" | "live";
const phaseInfo = new Gauge({
  name: `${PREFIX}_phase_info`,
  help: "Current poller phase (1 on the active phase, 0 elsewhere)",
  labelNames: ["phase"] as const,
  registers: [r],
});
export const setPhase = (phase: Phase) => {
  phaseInfo.set({ phase: "catchup" }, phase === "catchup" ? 1 : 0);
  phaseInfo.set({ phase: "live" }, phase === "live" ? 1 : 0);
};

import { getPool } from "@chicmoz-pkg/postgres-helper";
import { startPgPoolSampler } from "@chicmoz-pkg/metrics-server";
import { blockFetcherPool } from "../svcs/poller/pollers/block_poller/worker-pool.js";
import { getAmountOfOnlineNodes } from "../svcs/poller/network-client/pool.js";
import { metrics, setFetcherStats, setRpcNodesOnline } from "./registry.js";

const DEFAULT_INTERVAL_MS = 5000;

let stop: (() => void) | undefined;

export const startMetricsSampler = () => {
  if (stop) return;

  const intervalMs = Number.parseInt(
    process.env.METRICS_SAMPLE_INTERVAL_MS ?? String(DEFAULT_INTERVAL_MS),
    10,
  );

  const pgSampler = startPgPoolSampler(
    metrics,
    () => {
      const pool = getPool();
      return {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
      };
    },
    intervalMs,
  );

  const tick = () => {
    try {
      setFetcherStats({
        queue: blockFetcherPool.getQueueSize(),
        active: blockFetcherPool.getActiveWorkers(),
        cache: blockFetcherPool.getCacheSize(),
      });
    } catch {
      // pool may not be started yet
    }
    try {
      setRpcNodesOnline(getAmountOfOnlineNodes());
    } catch {
      // pool may not be initialized yet
    }
  };

  tick();
  const handle = setInterval(tick, intervalMs);
  if (typeof handle.unref === "function") handle.unref();

  stop = () => {
    clearInterval(handle);
    pgSampler.stop();
    stop = undefined;
  };
};

export const stopMetricsSampler = () => {
  if (stop) stop();
};

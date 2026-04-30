import { getPool } from "@chicmoz-pkg/postgres-helper";
import { startPgPoolSampler } from "@chicmoz-pkg/metrics-server";
import { metrics } from "./registry.js";

const DEFAULT_INTERVAL_MS = 5000;

let stopFn: (() => void) | undefined;

export const startMetricsSampler = () => {
  if (stopFn) return;
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
  stopFn = () => {
    pgSampler.stop();
    stopFn = undefined;
  };
};

export const stopMetricsSampler = () => {
  if (stopFn) stopFn();
};

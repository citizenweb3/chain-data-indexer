import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "prom-client";
import type { Application, Request, Response } from "express";

export type MetricsRegistry = {
  registry: Registry;
  prefix: string;
};

export const createRegistry = (prefix: string): MetricsRegistry => {
  const registry = new Registry();
  registry.setDefaultLabels({});
  return { registry, prefix };
};

/**
 * Mount Prometheus /metrics route on an existing Express app.
 * Replaces any pre-existing GET /metrics handler (Express picks the first match;
 * the caller is responsible for removing duplicates).
 */
export const mountMetricsRoute = (
  app: Application,
  metricsRegistry: MetricsRegistry,
  path: string = "/metrics",
): void => {
  app.get(path, async (_req: Request, res: Response) => {
    try {
      res.set("Content-Type", metricsRegistry.registry.contentType);
      const body = await metricsRegistry.registry.metrics();
      res.send(body);
    } catch (err) {
      res.status(500).send(`# metrics collection failed: ${(err as Error).message}\n`);
    }
  });
};

/**
 * Register Node.js default metrics (event loop lag, GC, memory, handles, ...) under
 * the given prefix. Safe to call once per registry.
 */
export const startNodeDefaultMetrics = (mr: MetricsRegistry): void => {
  collectDefaultMetrics({
    register: mr.registry,
    prefix: `${mr.prefix}_node_`,
  });
};

export type PoolStatsProvider = () => {
  total: number;
  idle: number;
  waiting: number;
};

/**
 * Sample pg pool stats every intervalMs and update three gauges.
 * Returns a stop() function. Interval is unref'd so it doesn't block process exit.
 */
export const startPgPoolSampler = (
  mr: MetricsRegistry,
  getStats: PoolStatsProvider,
  intervalMs: number = 5000,
): { stop: () => void } => {
  const active = new Gauge({
    name: `${mr.prefix}_pg_pool_active`,
    help: "Active (in-use) Postgres pool clients (total - idle)",
    registers: [mr.registry],
  });
  const idle = new Gauge({
    name: `${mr.prefix}_pg_pool_idle`,
    help: "Idle Postgres pool clients",
    registers: [mr.registry],
  });
  const waiting = new Gauge({
    name: `${mr.prefix}_pg_pool_waiting`,
    help: "Pending acquire requests waiting for a Postgres pool client",
    registers: [mr.registry],
  });

  const tick = () => {
    try {
      const s = getStats();
      const used = Math.max(0, s.total - s.idle);
      active.set(used);
      idle.set(s.idle);
      waiting.set(s.waiting);
    } catch {
      // pool might not be initialized yet; ignore
    }
  };

  tick();
  const handle = setInterval(tick, intervalMs);
  if (typeof handle.unref === "function") handle.unref();

  return {
    stop: () => clearInterval(handle),
  };
};

export { Counter, Gauge, Histogram, Registry } from "prom-client";

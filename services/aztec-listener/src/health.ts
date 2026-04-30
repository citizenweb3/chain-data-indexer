import express from "express";
import { mountMetricsRoute } from "@chicmoz-pkg/metrics-server";
import { getPool } from "@chicmoz-pkg/postgres-helper";
import { getAmountOfOnlineNodes } from "./svcs/poller/network-client/pool.js";
import { logger } from "./logger.js";
import { metrics } from "./metrics/registry.js";

const app = express();

interface HealthCheck {
  postgres: boolean;
  rpcNodes: boolean;
}

interface HealthResponse {
  status: "healthy" | "unhealthy";
  checks: HealthCheck;
  timestamp: string;
  service: string;
}

app.get("/health", async (req, res) => {
  const checks: HealthCheck = {
    postgres: false,
    rpcNodes: false,
  };

  // Проверка PostgreSQL
  try {
    const pool = getPool();
    const client = await pool.connect();
    await client.query("SELECT 1");
    client.release();
    checks.postgres = true;
  } catch (e) {
    logger.error({
      msg: "Health check: PostgreSQL failed",
      error: (e as Error).message,
    });
  }

  // Проверка RPC nodes
  try {
    const onlineNodes = getAmountOfOnlineNodes();
    checks.rpcNodes = onlineNodes > 0;
  } catch (e) {
    logger.error({
      msg: "Health check: RPC nodes failed",
      error: (e as Error).message,
    });
  }

  const isHealthy = checks.postgres && checks.rpcNodes;
  const statusCode = isHealthy ? 200 : 503;

  const response: HealthResponse = {
    status: isHealthy ? "healthy" : "unhealthy",
    checks,
    timestamp: new Date().toISOString(),
    service: "aztec-listener",
  };

  res.status(statusCode).json(response);
});

// Метрики для Prometheus
mountMetricsRoute(app, metrics);

export const startHealthServer = () => {
  const port = parseInt(process.env.HEALTH_PORT || "8000", 10);
  app.listen(port, () => {
    logger.info({ msg: `Health server listening on port ${port}` });
  });
};

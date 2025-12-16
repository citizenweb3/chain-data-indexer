import {
  startMicroservice,
  type MicroserviceConfig,
} from "@chicmoz-pkg/microservice-base";
import { getPool } from "@chicmoz-pkg/postgres-helper";
import { start } from "./start.js";
import { logger } from "./logger.js";
import { services } from "./svcs/index.js";
import { clearAllLimiters } from "./svcs/poller/network-client/rate-limiter.js";

const formatConfigLog = () => {
  return `TODO: is this needed if each service logs?`;
};

// Флаг для graceful shutdown
let isShuttingDown = false;

// Graceful shutdown handler
const gracefulShutdown = async (signal: string) => {
  if (isShuttingDown) {
    logger.warn({ msg: `Already shutting down, ignoring ${signal}` });
    return;
  }

  isShuttingDown = true;
  logger.info({ msg: `Received ${signal}, starting graceful shutdown...` });

  try {
    // 1. Остановить rate limiters (предотвратить новые RPC-запросы)
    clearAllLimiters();
    logger.info({ msg: "Rate limiters stopped" });

    // 2. Дать время завершить активные операции (5 секунд)
    const shutdownTimeout = parseInt(
      process.env.SHUTDOWN_TIMEOUT_SEC || "30",
      10,
    );
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(shutdownTimeout, 5) * 1000),
    );

    // 3. Закрыть пул соединений БД
    try {
      const pool = getPool();
      await pool.end();
      logger.info({ msg: "Database pool closed" });
    } catch (e) {
      logger.warn({
        msg: "Database pool already closed or not initialized",
      });
    }

    logger.info({ msg: "Graceful shutdown completed" });
    process.exit(0);
  } catch (error) {
    logger.error({
      msg: "Error during graceful shutdown",
      error: (error as Error).message,
    });
    process.exit(1);
  }
};

// Регистрация обработчиков сигналов
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

const main = () => {
  const config: MicroserviceConfig = {
    serviceName: "AZTEC LISTENER",
    logger,
    formattedConfig: formatConfigLog(),
    services,
    startCallback: start,
  };
  startMicroservice(config);
};

main();

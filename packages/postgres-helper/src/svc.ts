import {
  MicroserviceBaseSvcState,
  getSvcState,
  type MicroserviceBaseSvc,
} from "@chicmoz-pkg/microservice-base";
import { DrizzleConfig } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import {
  dbCredentials,
  getConfigStr,
  POSTGRES_POOL_MIN,
  POSTGRES_POOL_MAX,
  POSTGRES_POOL_IDLE_TIMEOUT_MS,
  POSTGRES_POOL_CONNECTION_TIMEOUT_MS,
} from "./environment.js";

let pool: pg.Pool;
let db: ReturnType<typeof drizzle>;
const serviceId = "DB";

// Используем значения из переменных окружения
const DEFAULT_POOL_CONFIG = {
  min: POSTGRES_POOL_MIN,
  max: POSTGRES_POOL_MAX,
  idleTimeoutMillis: POSTGRES_POOL_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: POSTGRES_POOL_CONNECTION_TIMEOUT_MS,
  allowExitOnIdle: false,
  maxUses: 7500,
};

const init = async (
  drizzleConfig: DrizzleConfig<Record<string, unknown>>,
  poolConfig = DEFAULT_POOL_CONFIG,
) => {
  pool = new pg.Pool({
    ...dbCredentials,
    ...poolConfig,
  });

  // Log pool events for debugging
  pool.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error("[POSTGRES] Unexpected error on idle client", err);
  });

  pool.on("connect", () => {
    // eslint-disable-next-line no-console
    console.log(
      `[POSTGRES] New client connected. Total: ${pool.totalCount}, Idle: ${pool.idleCount}, Waiting: ${pool.waitingCount}`,
    );
  });

  pool.on("acquire", () => {
    // eslint-disable-next-line no-console
    console.log(
      `[POSTGRES] Client acquired. Total: ${pool.totalCount}, Idle: ${pool.idleCount}, Waiting: ${pool.waitingCount}`,
    );
  });

  pool.on("remove", () => {
    // eslint-disable-next-line no-console
    console.log(
      `[POSTGRES] Client removed. Total: ${pool.totalCount}, Idle: ${pool.idleCount}, Waiting: ${pool.waitingCount}`,
    );
  });

  db = drizzle(pool, drizzleConfig);

  try {
    const client = await pool.connect();
    client.release();
    // eslint-disable-next-line no-console
    console.log("[POSTGRES] Database connection pool established successfully");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      "[POSTGRES] Failed to establish database connection pool",
      err,
    );
    throw err;
  }
};

export const getDb = () => {
  try {
    const state = getSvcState(serviceId);

    if (state !== MicroserviceBaseSvcState.UP) {
      if (state === MicroserviceBaseSvcState.SHUTTING_DOWN) {
        throw new Error("Database is shutting down");
      } else if (state === MicroserviceBaseSvcState.DOWN) {
        throw new Error("Database is down");
      } else if (state === MicroserviceBaseSvcState.INITIALIZING) {
        throw new Error("Database is initializing");
      }
    }
  } catch (error) {
    throw new Error("Database is not initialized");
  }
  return db;
};

export const getPool = () => {
  if (!pool) {
    throw new Error("Database pool is not initialized");
  }
  return pool;
};

export const generateSvc: (
  drizzleConf: DrizzleConfig<Record<string, unknown>>,
  poolConfig?: typeof DEFAULT_POOL_CONFIG,
) => MicroserviceBaseSvc = (drizzleConf, poolConfig) => ({
  svcId: "DB",
  init: () => init(drizzleConf, poolConfig),
  getConfigStr,
  health: () => getSvcState(serviceId) === MicroserviceBaseSvcState.UP,
  shutdown: async () => {
    await pool.end();
  },
});

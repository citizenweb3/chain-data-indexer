import fs from 'node:fs';
import pg from 'pg';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export interface PgPoolStats {
  active: number;
  idle: number;
  waiting: number;
}

function pgSslConfig(): pg.PoolConfig['ssl'] {
  if (!config.PG_SSL) return undefined;
  if (!config.PG_SSL_CA) return true;
  return { ca: fs.readFileSync(config.PG_SSL_CA, 'utf8') };
}

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      host: config.PG_HOST,
      port: config.PG_PORT,
      database: config.PG_DB,
      user: config.PG_USER,
      password: config.PG_PASSWORD,
      ssl: pgSslConfig(),
      max: 10,
    });
    pool.on('error', (err) => {
      logger.error('PostgreSQL pool idle client error', { err });
    });
  }
  return pool;
}

export function getPoolStats(): PgPoolStats {
  const current = getPool();
  return {
    active: Math.max(0, current.totalCount - current.idleCount),
    idle: current.idleCount,
    waiting: current.waitingCount,
  };
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

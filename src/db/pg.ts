import fs from 'node:fs';
import pg from 'pg';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const { Pool } = pg;
type PoolClient = pg.PoolClient;

let pool: pg.Pool | null = null;

export interface PgPoolStats {
  active: number;
  idle: number;
  waiting: number;
}

function pgSslConfig(): pg.PoolConfig['ssl'] {
  if (config.PG_SSL === 'disable') return undefined;
  if (config.PG_SSL === 'require') {
    if (config.PG_SSL_CA) {
      return { ca: fs.readFileSync(config.PG_SSL_CA, 'utf8'), rejectUnauthorized: false };
    }
    return { rejectUnauthorized: false };
  }
  // verify-full
  if (!config.PG_SSL_CA) {
    throw new Error('PG_SSL=verify-full requires PG_SSL_CA');
  }
  return { ca: fs.readFileSync(config.PG_SSL_CA, 'utf8'), rejectUnauthorized: true };
}

export function getPool(): pg.Pool {
  if (!pool) {
    pool = config.DATABASE_URL
      ? new Pool({ connectionString: config.DATABASE_URL, max: 10 })
      : new Pool({
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

export async function withTx<T>(poolOrClient: pg.Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await poolOrClient.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

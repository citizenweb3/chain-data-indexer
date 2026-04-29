import pg from 'pg';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const { Pool } = pg;
type PoolClient = pg.PoolClient;

let pool: pg.Pool | null = null;

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
          max: 10,
        });
    pool.on('error', (err) => {
      logger.error('PostgreSQL pool idle client error', { err });
    });
  }
  return pool;
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

import pg from 'pg';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
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

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Utilities for creating and managing a PostgreSQL connection pool.
 * Provides functions to create, retrieve and close the pool.
 */
// src/db/pg.ts
import { Pool } from 'pg';

/**
 * Holds configuration options for PostgreSQL connection pool.
 * @property {string} [connectionString] Optional full connection string, e.g. postgres://user:pass@host:2432/cosmos_indexer_db
 * @property {string} [host] Database host
 * @property {number} [port] Database port
 * @property {string} [user] Database user
 * @property {string} [password] Database password
 * @property {string} [database] Database name
 * @property {boolean} [ssl] Whether to use SSL connection
 * @property {string} [applicationName] Application name for Postgres connections
 * @property {number} [poolSize] Maximum number of clients in the pool, default is 16
 */
export type PgConfig = {
  /**
   * Optional full connection string, e.g. postgres://user:pass@host:2432/cosmos_indexer_db
   */
  connectionString?: string;
  /** Database host */
  host?: string;
  /** Database port */
  port?: number;
  /** Database user */
  user?: string;
  /** Database password */
  password?: string;
  /** Database name */
  database?: string;
  /** Whether to use SSL connection */
  ssl?: boolean;
  /** Application name for Postgres connections */
  applicationName?: string;
  /** Maximum number of clients in the pool, default is 16 */
  poolSize?: number;
};

let pool: Pool | null = null;

/**
 * Create (if not already created) and return a shared PostgreSQL connection pool.
 * @param {PgConfig} cfg Configuration options for the connection pool.
 * @returns {Pool} A singleton instance of the PostgreSQL connection pool.
 */
export function createPgPool(cfg: PgConfig): Pool {
  if (pool) return pool;
  pool = new Pool({
    connectionString: cfg.connectionString,
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
    application_name: cfg.applicationName ?? 'cosmos-indexer',
    max: cfg.poolSize ?? 16,
    idleTimeoutMillis: 30_000,
  });
  return pool;
}

/**
 * Retrieve the existing PostgreSQL connection pool.
 * Throws an error if the pool has not been initialized yet.
 * @returns {Pool} The existing PostgreSQL connection pool.
 */
export function getPgPool(): Pool {
  if (!pool) throw new Error('PG pool is not initialized');
  return pool;
}

/**
 * Close the PostgreSQL connection pool and release all resources.
 * @returns {Promise<void>} Promise that resolves when the pool is closed.
 */
export async function closePgPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

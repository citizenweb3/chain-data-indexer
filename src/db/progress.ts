/**
 * @module progress
 * This module handles reading and updating indexer progress in the database.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Pool, PoolClient } from 'pg';

/**
 * Retrieves the last processed block height for the given indexer ID.
 *
 * @param poolOrClient - PostgreSQL connection pool or client to execute the query.
 * @param id - Unique identifier for the indexer whose progress is being retrieved.
 * @returns The last processed block height as a number, or null if no progress record exists.
 */
export async function getProgress(poolOrClient: Pool | PoolClient, id: string): Promise<number | null> {
  const sql = `SELECT last_height FROM core.indexer_progress WHERE id = $1`;
  const res = await (poolOrClient as any).query(sql, [id]);
  return res.rowCount ? Number(res.rows[0].last_height) : null;
}

/**
 * Inserts or updates the last processed block height for the given indexer ID.
 *
 * If a record for the provided ID exists, it updates the `last_height` and sets `updated_at` to now.
 * Otherwise, it creates a new record.
 *
 * @param client - PostgreSQL client to execute the upsert query.
 * @param id - Unique identifier for the indexer whose progress is being recorded.
 * @param lastHeight - The last processed block height to store.
 */
export async function upsertProgress(client: PoolClient, id: string, lastHeight: number): Promise<void> {
  const sql = `
    INSERT INTO core.indexer_progress (id, last_height)
    VALUES ($1, $2)
    ON CONFLICT (id)
    DO UPDATE SET last_height = EXCLUDED.last_height, updated_at = now()
  `;
  await client.query(sql, [id, lastHeight]);
}

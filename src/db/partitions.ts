// src/db/partitions.ts

/**
 * This module handles creation of range-based partitions for specified database tables,
 * as well as hash-based partitions for event tables.
 */
import type { PoolClient } from 'pg';

const STEP = 1_000_000;

const RANGE_TABLES: Array<{ schema: string; table: string }> = [
  { schema: 'core', table: 'blocks' },
  { schema: 'core', table: 'validator_set' },
  { schema: 'core', table: 'validator_missed_blocks' },
  { schema: 'core', table: 'transactions' },
  { schema: 'core', table: 'messages' },
  { schema: 'bank', table: 'transfers' },
  { schema: 'bank', table: 'balance_deltas' },
  { schema: 'stake', table: 'delegation_events' },
  { schema: 'stake', table: 'distribution_events' },
  { schema: 'gov', table: 'deposits' },
  { schema: 'gov', table: 'votes' },
  { schema: 'wasm', table: 'contract_migrations' },
  { schema: 'wasm', table: 'executions' },
  { schema: 'wasm', table: 'events' },
  { schema: 'core', table: 'events' },
  { schema: 'wasm', table: 'state_kv' },
  { schema: 'tokens', table: 'cw20_transfers' },
  { schema: 'authz_feegrant', table: 'authz_grants' },
  { schema: 'authz_feegrant', table: 'fee_grants' },
  { schema: 'core', table: 'network_params' },
  { schema: 'core', table: 'event_attrs' },
];

/**
 * Tables whose new partitions are created UNLOGGED when bulk mode is active.
 * Must match `UNLOGGED_PARENT_TABLES` in src/db/bulk-mode.ts.
 *
 * UNLOGGED tables skip WAL writes — major throughput win during backfill.
 * Trade-off: contents are TRUNCATED on unclean shutdown / crash. The indexer
 * resumes from `core.indexer_progress`, so any lost data is re-fetched and
 * re-ingested. Safe in bulk-mode backfill, unsafe in follow mode (handled
 * by `bulkSetLogged()` which converts everything back before exit).
 */
const UNLOGGED_ELIGIBLE = new Set<string>([
  'core.transactions',
  'core.events',
  'core.event_attrs',
  'core.messages',
  'bank.transfers',
  'stake.delegation_events',
  'stake.distribution_events',
  'wasm.executions',
  'wasm.events',
]);

/**
 * Ensures that range partitions exist for core and related schema tables between the specified height range.
 * Partitions are created in steps of 1,000,000 heights.
 * Additionally, ensures hash-based partitions for the "core.events" table.
 *
 * @param client - The PostgreSQL client to execute queries with.
 * @param minH - The minimum height for which partitions should be ensured.
 * @param maxH - Optional maximum height for partition creation; if omitted, uses minH.
 * @param unlogged - When true, NEW partitions for tables in `UNLOGGED_ELIGIBLE`
 *                   are created with `UNLOGGED` to skip WAL during bulk ingest.
 *                   Existing partitions are never converted here.
 *
 * Behavior:
 * - Acquires an advisory lock to prevent concurrent partition creation.
 * - Creates hash partitions for the "core.events" table based on configured modulus.
 * - Creates range partitions for each table in RANGE_TABLES within the specified height range.
 */
export async function ensureCorePartitions(client: PoolClient, minH: number, maxH?: number, unlogged = false) {
  if (!Number.isFinite(minH)) return;
  const startBase = Math.floor(minH / STEP) * STEP;
  const endBase = Math.floor((maxH ?? minH) / STEP) * STEP;

  await client.query(`SELECT pg_advisory_lock($1)`, [0x70617274]);
  try {
    for (let base = startBase; base <= endBase; base += STEP) {
      const from = base;
      const to = base + STEP;

      await createRangePartition(client, 'core', 'blocks', from, to, unlogged && UNLOGGED_ELIGIBLE.has('core.blocks'));

      for (const { schema, table } of RANGE_TABLES) {
        if (schema === 'core' && table === 'blocks') continue;
        const useUnlogged = unlogged && UNLOGGED_ELIGIBLE.has(`${schema}.${table}`);
        await createRangePartition(client, schema, table, from, to, useUnlogged);
      }
    }
  } finally {
    await client.query(`SELECT pg_advisory_unlock($1)`, [0x70617274]);
  }
}

/**
 * Creates a single range partition for a given schema and table covering the specified range.
 *
 * @param client - The PostgreSQL client to execute queries with.
 * @param schema - The schema name of the parent table.
 * @param table - The parent table name to partition.
 * @param from - The start of the range (inclusive) for the partition.
 * @param to - The end of the range (exclusive) for the partition.
 * @param unlogged - When true, the partition is created as UNLOGGED (no WAL).
 *                   Has no effect on existing partitions.
 */
async function createRangePartition(
  client: PoolClient,
  schema: string,
  table: string,
  from: number,
  to: number,
  unlogged = false,
) {
  const parent = `"${schema}"."${table}"`;
  const child = `"${schema}"."${table}_p${from}"`;
  const persistence = unlogged ? 'UNLOGGED ' : '';

  const sql = `
    CREATE ${persistence}TABLE IF NOT EXISTS ${child}
    PARTITION OF ${parent}
    FOR VALUES FROM (${from}) TO (${to});
  `;
  await client.query(sql);
}


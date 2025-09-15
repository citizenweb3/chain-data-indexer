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
  { schema: 'wasm', table: 'state_kv' },
  { schema: 'tokens', table: 'cw20_transfers' },
  { schema: 'authz_feegrant', table: 'authz_grants' },
  { schema: 'authz_feegrant', table: 'fee_grants' },
  { schema: 'core', table: 'network_params' },
];

/**
 * Ensures that range partitions exist for core and related schema tables between the specified height range.
 * Partitions are created in steps of 1,000,000 heights.
 * Additionally, ensures hash-based partitions for the "core.events" table.
 *
 * @param client - The PostgreSQL client to execute queries with.
 * @param minH - The minimum height for which partitions should be ensured.
 * @param maxH - Optional maximum height for partition creation; if omitted, uses minH.
 *
 * Behavior:
 * - Acquires an advisory lock to prevent concurrent partition creation.
 * - Creates hash partitions for the "core.events" table based on configured modulus.
 * - Creates range partitions for each table in RANGE_TABLES within the specified height range.
 */
export async function ensureCorePartitions(client: PoolClient, minH: number, maxH?: number) {
  if (!Number.isFinite(minH)) return;
  const startBase = Math.floor(minH / STEP) * STEP;
  const endBase = Math.floor((maxH ?? minH) / STEP) * STEP;

  await client.query(`SELECT pg_advisory_lock($1)`, [0x70617274]);
  try {
    await ensureEventsHashPartitions(client);

    for (let base = startBase; base <= endBase; base += STEP) {
      const from = base;
      const to = base + STEP;

      await createRangePartition(client, 'core', 'blocks', from, to);

      for (const { schema, table } of RANGE_TABLES) {
        if (schema === 'core' && table === 'blocks') continue;
        await createRangePartition(client, schema, table, from, to);
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
 */
async function createRangePartition(client: PoolClient, schema: string, table: string, from: number, to: number) {
  const parent = `"${schema}"."${table}"`;
  const child = `"${schema}"."${table}_p${from}"`;

  const sql = `
    CREATE TABLE IF NOT EXISTS ${child}
    PARTITION OF ${parent}
    FOR VALUES FROM (${from}) TO (${to});
  `;
  await client.query(sql);
}

/**
 * Ensures hash-based partitions exist for the "core.events" table.
 * Reads the configured hash modulus from the database setting 'app.events.hash_modulus',
 * defaulting to 16 if not set or invalid.
 * Creates partitions for each remainder from 0 to modulus-1.
 *
 * @param client - The PostgreSQL client to execute queries with.
 */
async function ensureEventsHashPartitions(client: PoolClient): Promise<void> {
  const res = await client.query<{ value: string }>(`SELECT current_setting('app.events.hash_modulus', true) AS value`);
  let modulus = 16;
  if (res.rows.length > 0) {
    const val = Number(res.rows[0].value);
    if (Number.isInteger(val) && val > 0) {
      modulus = val;
    }
  }

  for (let r = 0; r < modulus; r++) {
    const suffix = r.toString().padStart(2, '0');
    const sql = `
      CREATE TABLE IF NOT EXISTS "core"."events_h${suffix}"
      PARTITION OF "core"."events"
      FOR VALUES WITH (MODULUS ${modulus}, REMAINDER ${r});
    `;
    await client.query(sql);
  }
}

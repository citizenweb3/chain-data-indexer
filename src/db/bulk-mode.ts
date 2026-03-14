/**
 * Automatic bulk-mode management for high-performance backfill ingestion.
 *
 * During bulk backfill (millions of blocks), secondary indexes slow down INSERTs
 * dramatically. This module persists bulk-mode state, reconciles it against DB
 * metadata on restart, and manages the lifecycle: detect → disable autovacuum →
 * ingest → create indexes → re-enable autovacuum → vacuum analyze.
 */
// src/db/bulk-mode.ts
import type { Pool, PoolClient } from 'pg';
import { getLogger } from '../utils/logger.js';

const log = getLogger('bulk-mode');

const BULK_MODE_STATES = {
  BULK: 0,
  FINALIZING: 1,
  FINALIZED: 2,
} as const;

type BulkModeState = (typeof BULK_MODE_STATES)[keyof typeof BULK_MODE_STATES];

const BULK_MODE_STATE_PREFIX = '__bulk_mode__';

/** Tables that receive the highest write throughput during backfill. */
const HOT_TABLES = [
  'core.transactions',
  'core.events',
  'core.event_attrs',
  'core.messages',
  'bank.transfers',
  'stake.delegation_events',
  'stake.distribution_events',
] as const;

/** All deferred indexes to be created after bulk ingestion completes. */
const INDEXES = [
  // core.transactions (6 indexes)
  { name: 'idx_txs_code', sql: 'CREATE INDEX IF NOT EXISTS idx_txs_code ON core.transactions (code)' },
  {
    name: 'idx_txs_signers_gin',
    sql: 'CREATE INDEX IF NOT EXISTS idx_txs_signers_gin ON core.transactions USING GIN (signers)',
  },
  { name: 'idx_txs_time', sql: 'CREATE INDEX IF NOT EXISTS idx_txs_time ON core.transactions (time DESC)' },
  {
    name: 'idx_txs_success',
    sql: 'CREATE INDEX IF NOT EXISTS idx_txs_success ON core.transactions (height DESC, tx_index) WHERE code = 0',
  },
  { name: 'idx_txs_hash', sql: 'CREATE INDEX IF NOT EXISTS idx_txs_hash ON core.transactions (tx_hash)' },
  {
    name: 'uq_txs_height_pos',
    sql: 'CREATE UNIQUE INDEX IF NOT EXISTS uq_txs_height_pos ON core.transactions (height, tx_index)',
  },
  // core.messages (4 indexes)
  {
    name: 'idx_msgs_height_type',
    sql: 'CREATE INDEX IF NOT EXISTS idx_msgs_height_type ON core.messages (height DESC, type_url)',
  },
  { name: 'idx_msgs_signer', sql: 'CREATE INDEX IF NOT EXISTS idx_msgs_signer ON core.messages (signer, height DESC)' },
  {
    name: 'idx_msgs_value_path',
    sql: 'CREATE INDEX IF NOT EXISTS idx_msgs_value_path ON core.messages USING GIN (value jsonb_path_ops)',
  },
  {
    name: 'idx_msgs_txhash_msg',
    sql: 'CREATE INDEX IF NOT EXISTS idx_msgs_txhash_msg ON core.messages (tx_hash, msg_index)',
  },
  // core.events (2 indexes)
  { name: 'idx_events_type', sql: 'CREATE INDEX IF NOT EXISTS idx_events_type ON core.events (event_type)' },
  {
    name: 'idx_events_type_msg',
    sql: 'CREATE INDEX IF NOT EXISTS idx_events_type_msg ON core.events (event_type, msg_index)',
  },
  // core.event_attrs (2 indexes)
  { name: 'idx_event_attrs_key', sql: 'CREATE INDEX IF NOT EXISTS idx_event_attrs_key ON core.event_attrs (key)' },
  {
    name: 'idx_event_attrs_key_value_md5',
    sql: `CREATE INDEX IF NOT EXISTS idx_event_attrs_key_value_md5 ON core.event_attrs (key, md5(COALESCE(value, '')))`,
  },
  // bank.transfers (4 indexes)
  {
    name: 'idx_transfers_from',
    sql: 'CREATE INDEX IF NOT EXISTS idx_transfers_from ON bank.transfers (from_addr, height DESC)',
  },
  {
    name: 'idx_transfers_to',
    sql: 'CREATE INDEX IF NOT EXISTS idx_transfers_to ON bank.transfers (to_addr, height DESC)',
  },
  { name: 'idx_transfers_denom', sql: 'CREATE INDEX IF NOT EXISTS idx_transfers_denom ON bank.transfers (denom)' },
  {
    name: 'idx_transfers_brin_height',
    sql: 'CREATE INDEX IF NOT EXISTS idx_transfers_brin_height ON bank.transfers USING BRIN (height)',
  },
  // stake.delegation_events (3 indexes)
  {
    name: 'idx_del_ev_delegator',
    sql: 'CREATE INDEX IF NOT EXISTS idx_del_ev_delegator ON stake.delegation_events (delegator_address, height DESC)',
  },
  {
    name: 'idx_del_ev_valdst',
    sql: 'CREATE INDEX IF NOT EXISTS idx_del_ev_valdst ON stake.delegation_events (validator_dst, height DESC)',
  },
  {
    name: 'idx_del_ev_valsrc',
    sql: 'CREATE INDEX IF NOT EXISTS idx_del_ev_valsrc ON stake.delegation_events (validator_src, height DESC)',
  },
  // stake.distribution_events (2 indexes)
  {
    name: 'idx_dist_ev_validator',
    sql: 'CREATE INDEX IF NOT EXISTS idx_dist_ev_validator ON stake.distribution_events (validator_address, height DESC)',
  },
  {
    name: 'idx_dist_ev_delegator',
    sql: 'CREATE INDEX IF NOT EXISTS idx_dist_ev_delegator ON stake.distribution_events (delegator_address, height DESC)',
  },
  // gov (4 indexes)
  { name: 'idx_gov_status', sql: 'CREATE INDEX IF NOT EXISTS idx_gov_status ON gov.proposals (status)' },
  {
    name: 'idx_gov_dep_depositor',
    sql: 'CREATE INDEX IF NOT EXISTS idx_gov_dep_depositor ON gov.deposits (depositor, height DESC)',
  },
  {
    name: 'idx_gov_votes_voter',
    sql: 'CREATE INDEX IF NOT EXISTS idx_gov_votes_voter ON gov.votes (voter, height DESC)',
  },
  {
    name: 'idx_gov_votes_prop',
    sql: 'CREATE INDEX IF NOT EXISTS idx_gov_votes_prop ON gov.votes (proposal_id, option)',
  },
  // wasm.executions (4 indexes)
  {
    name: 'idx_wasm_exec_contract',
    sql: 'CREATE INDEX IF NOT EXISTS idx_wasm_exec_contract ON wasm.executions (contract, height DESC)',
  },
  {
    name: 'idx_wasm_exec_msg_gin',
    sql: 'CREATE INDEX IF NOT EXISTS idx_wasm_exec_msg_gin ON wasm.executions USING GIN (msg jsonb_path_ops)',
  },
  {
    name: 'idx_wasm_exec_success',
    sql: 'CREATE INDEX IF NOT EXISTS idx_wasm_exec_success ON wasm.executions (success)',
  },
  {
    name: 'idx_wasm_exec_tx_msg',
    sql: 'CREATE INDEX IF NOT EXISTS idx_wasm_exec_tx_msg ON wasm.executions (tx_hash, msg_index)',
  },
  // wasm.events (3 indexes)
  {
    name: 'idx_wasm_events_contract',
    sql: 'CREATE INDEX IF NOT EXISTS idx_wasm_events_contract ON wasm.events (contract, height DESC)',
  },
  { name: 'idx_wasm_events_type', sql: 'CREATE INDEX IF NOT EXISTS idx_wasm_events_type ON wasm.events (event_type)' },
  {
    name: 'idx_wasm_events_tx_msg',
    sql: 'CREATE INDEX IF NOT EXISTS idx_wasm_events_tx_msg ON wasm.events (tx_hash, msg_index)',
  },
].map((index) => {
  const tableMatch = /\bON\s+([a-z_]+)\.([a-z_]+)\b/i.exec(index.sql);
  if (!tableMatch) {
    throw new Error(`Failed to parse indexed table for deferred index ${index.name}`);
  }

  const [, tableSchema, tableName] = tableMatch;
  return {
    ...index,
    tableSchema,
    tableName,
  };
});

/**
 * Recursive CTE that finds leaf partitions (relkind = 'r' with no children)
 * for a given parent table specified by schema + table name.
 */
const LEAF_PARTITIONS_BASE_CTE = `
  WITH RECURSIVE part_tree AS (
    SELECT c.oid, c.relnamespace, c.relname, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1 AND c.relname = $2
    UNION ALL
    SELECT child.oid, child.relnamespace, child.relname, child.relkind
    FROM pg_inherits i
    JOIN pg_class child ON child.oid = i.inhrelid
    JOIN part_tree pt ON pt.oid = i.inhparent
  )
`;

const LEAF_PARTITIONS_CTE = `
  ${LEAF_PARTITIONS_BASE_CTE}
  SELECT n.nspname || '.' || pt.relname AS fqn
  FROM part_tree pt
  JOIN pg_namespace n ON n.oid = pt.relnamespace
  WHERE pt.relkind = 'r'
    AND NOT EXISTS (
      SELECT 1 FROM pg_inherits ci WHERE ci.inhparent = pt.oid
    )
`;

const LEAF_PARTITIONS_AUTOVACUUM_CTE = `
  ${LEAF_PARTITIONS_BASE_CTE}
  SELECT
    n.nspname || '.' || pt.relname AS fqn,
    COALESCE(
      (
        SELECT option_value::boolean
        FROM pg_options_to_table(c.reloptions)
        WHERE option_name = 'autovacuum_enabled'
      ),
      TRUE
    ) AS autovacuum_enabled
  FROM part_tree pt
  JOIN pg_namespace n ON n.oid = pt.relnamespace
  JOIN pg_class c ON c.oid = pt.oid
  WHERE pt.relkind = 'r'
    AND NOT EXISTS (
      SELECT 1 FROM pg_inherits ci WHERE ci.inhparent = pt.oid
    )
`;

type Queryable = Pool | PoolClient;
export type BulkModeDetectionSource = 'persisted' | 'inferred';
export type BulkModeStatus = {
  enabled: boolean;
  source: BulkModeDetectionSource;
  state: BulkModeState;
};

function getBulkModeStateId(progressId: string): string {
  return `${BULK_MODE_STATE_PREFIX}:${progressId}`;
}

export function getBulkModeTopologyError(shards: number): string | null {
  if (shards <= 1) {
    return null;
  }

  return [
    'Bulk mode requires exactly one writer per database.',
    `SHARDS=${shards} is unsafe because deferred index finalization and autovacuum changes apply to the whole database.`,
    'Re-run with SHARDS=1 until bulk mode is finalized, then restart sharded writers.',
  ].join(' ');
}

export function getBulkModeSafetyError(params: {
  detectionSource: BulkModeDetectionSource;
  resumeEnabled: boolean;
  hasBackfillRange: boolean;
  overlappingTables: string[];
}): string | null {
  if (params.detectionSource === 'persisted' || !params.hasBackfillRange) {
    return null;
  }

  if (params.resumeEnabled) {
    return 'Bulk mode auto-detection is only safe for fresh non-resume backfills. Re-run with RESUME=false, or finish the existing bulk-mode lifecycle before resuming.';
  }

  if (params.overlappingTables.length > 0) {
    return `Bulk mode auto-detection found existing rows in hot tables for the requested backfill range: ${params.overlappingTables.join(', ')}. Use a fresh/non-overlapping target or finish finalization and rerun in normal mode.`;
  }

  return null;
}

function isBulkModeState(value: number): value is BulkModeState {
  return Object.values(BULK_MODE_STATES).includes(value as BulkModeState);
}

function formatBulkModeState(state: BulkModeState): string {
  switch (state) {
    case BULK_MODE_STATES.BULK:
      return 'bulk';
    case BULK_MODE_STATES.FINALIZING:
      return 'finalizing';
    case BULK_MODE_STATES.FINALIZED:
      return 'finalized';
  }
}

async function readBulkModeState(poolOrClient: Queryable, progressId: string): Promise<BulkModeState | null> {
  const result = await poolOrClient.query<{ last_height: string | number }>(
    `SELECT last_height FROM core.indexer_progress WHERE id = $1`,
    [getBulkModeStateId(progressId)],
  );

  if (!result.rowCount) {
    return null;
  }

  const rawState = Number(result.rows[0]?.last_height);
  if (!Number.isFinite(rawState) || !isBulkModeState(rawState)) {
    log.warn(`Ignoring unknown bulk-mode state ${result.rows[0]?.last_height ?? 'null'} for ${progressId}`);
    return null;
  }

  return rawState;
}

async function writeBulkModeState(poolOrClient: Queryable, progressId: string, state: BulkModeState): Promise<void> {
  await poolOrClient.query(
    `
      INSERT INTO core.indexer_progress (id, last_height)
      VALUES ($1, $2)
      ON CONFLICT (id)
      DO UPDATE SET last_height = EXCLUDED.last_height, updated_at = now()
    `,
    [getBulkModeStateId(progressId), state],
  );
}

async function getDeferredIndexStatus(
  poolOrClient: Queryable,
): Promise<{ readyCount: number; missingOrInvalid: string[] }> {
  const result = await poolOrClient.query<{ name: string; is_ready: boolean }>(
    `
      WITH expected(name, table_schema, table_name) AS (
        SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
      )
      SELECT
        expected.name,
        COALESCE(
          BOOL_OR(
            ns.nspname = expected.table_schema
            AND tbl.relname = expected.table_name
            AND idx.relname = expected.name
            AND pg_idx.indisvalid
            AND pg_idx.indisready
          ),
          FALSE
        ) AS is_ready
      FROM expected
      LEFT JOIN pg_class idx
        ON idx.relname = expected.name
        AND idx.relkind = 'i'
      LEFT JOIN pg_index pg_idx
        ON pg_idx.indexrelid = idx.oid
      LEFT JOIN pg_class tbl
        ON tbl.oid = pg_idx.indrelid
      LEFT JOIN pg_namespace ns
        ON ns.oid = tbl.relnamespace
      GROUP BY expected.name
    `,
    [
      INDEXES.map((index) => index.name),
      INDEXES.map((index) => index.tableSchema),
      INDEXES.map((index) => index.tableName),
    ],
  );

  const readyNames = new Set(result.rows.filter((row) => row.is_ready).map((row) => row.name));
  const missingOrInvalid = INDEXES.map((index) => index.name).filter((name) => !readyNames.has(name));

  return {
    readyCount: INDEXES.length - missingOrInvalid.length,
    missingOrInvalid,
  };
}

async function getDisabledAutovacuumLeafPartitions(poolOrClient: Queryable): Promise<string[]> {
  const disabledLeafPartitions: string[] = [];

  for (const fqn of HOT_TABLES) {
    const [schema, table] = fqn.split('.');
    const { rows } = await poolOrClient.query<{ fqn: string; autovacuum_enabled: boolean }>(
      LEAF_PARTITIONS_AUTOVACUUM_CTE,
      [schema, table],
    );

    for (const row of rows) {
      if (row.autovacuum_enabled === false) {
        disabledLeafPartitions.push(row.fqn);
      }
    }
  }

  return disabledLeafPartitions;
}

function inferBulkModeState(readyCount: number, disabledLeafPartitions: string[]): BulkModeState {
  if (readyCount === INDEXES.length && disabledLeafPartitions.length === 0) {
    return BULK_MODE_STATES.FINALIZED;
  }

  if (readyCount === 0) {
    return BULK_MODE_STATES.BULK;
  }

  return BULK_MODE_STATES.FINALIZING;
}

/**
 * Detect whether the database is in bulk mode using an explicit durable state
 * marker first, then fall back to checking all deferred indexes and autovacuum
 * state if the marker does not exist yet.
 *
 * If finalization previously started but did not complete, the persisted state
 * keeps bulk mode ON across restarts even if some indexes were already created.
 */
export async function detectBulkMode(pool: Pool, progressId = 'default'): Promise<boolean> {
  return (await detectBulkModeStatus(pool, progressId)).enabled;
}

export async function detectBulkModeStatus(pool: Pool, progressId = 'default'): Promise<BulkModeStatus> {
  const persistedState = await readBulkModeState(pool, progressId);
  if (persistedState != null) {
    const bulkMode = persistedState !== BULK_MODE_STATES.FINALIZED;
    log.info(
      `Bulk mode detection: ${bulkMode ? 'ON' : 'OFF'} (persisted state: ${formatBulkModeState(persistedState)})`,
    );
    return {
      enabled: bulkMode,
      source: 'persisted',
      state: persistedState,
    };
  }

  const { readyCount, missingOrInvalid } = await getDeferredIndexStatus(pool);
  const disabledLeafPartitions = missingOrInvalid.length === 0 ? await getDisabledAutovacuumLeafPartitions(pool) : [];
  const inferredState = inferBulkModeState(readyCount, disabledLeafPartitions);
  await writeBulkModeState(pool, progressId, inferredState);

  const bulkMode = inferredState !== BULK_MODE_STATES.FINALIZED;
  if (bulkMode) {
    const missingPreview = missingOrInvalid.slice(0, 5).join(', ');
    const missingSuffix = missingOrInvalid.length > 5 ? ', …' : '';
    const autovacuumNote =
      disabledLeafPartitions.length > 0
        ? `; autovacuum disabled on ${disabledLeafPartitions.length} hot leaf partitions`
        : '';
    log.info(
      `Bulk mode detection: ON (inferred ${formatBulkModeState(inferredState)}; ${readyCount}/${INDEXES.length} deferred indexes ready${
        missingPreview ? `; missing/invalid: ${missingPreview}${missingSuffix}` : ''
      }${autovacuumNote})`,
    );
    return {
      enabled: true,
      source: 'inferred',
      state: inferredState,
    };
  }

  log.info(`Bulk mode detection: OFF (all ${INDEXES.length} deferred indexes ready; autovacuum enabled)`);
  return {
    enabled: bulkMode,
    source: 'inferred',
    state: inferredState,
  };
}

export async function findBulkModeOverlapTables(
  poolOrClient: Queryable,
  fromHeight: number,
  toHeight: number,
): Promise<string[]> {
  const overlappingTables: string[] = [];

  for (const fqn of HOT_TABLES) {
    const result = await poolOrClient.query<{ has_rows: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM ${fqn} WHERE height BETWEEN $1 AND $2 LIMIT 1) AS has_rows`,
      [fromHeight, toHeight],
    );

    if (result.rows[0]?.has_rows) {
      overlappingTables.push(fqn);
    }
  }

  return overlappingTables;
}

/**
 * Disable autovacuum on leaf partitions of hot tables to maximize write throughput.
 *
 * Uses a recursive CTE on `pg_inherits` to find leaf partitions (tables with
 * `relkind = 'r'` that have no children). Idempotent — safe to call multiple times.
 */
export async function disableAutovacuum(pool: Pool): Promise<void> {
  let totalAffected = 0;

  for (const fqn of HOT_TABLES) {
    const [schema, table] = fqn.split('.');
    const { rows } = await pool.query<{ fqn: string }>(LEAF_PARTITIONS_CTE, [schema, table]);

    for (const row of rows) {
      await pool.query(`ALTER TABLE ${row.fqn} SET (autovacuum_enabled = off)`);
    }

    totalAffected += rows.length;
  }

  log.info(`Disabled autovacuum on ${totalAffected} leaf partitions`);
}

/**
 * Re-enable autovacuum on leaf partitions of hot tables.
 */
async function enableAutovacuum(pool: Pool): Promise<void> {
  let totalAffected = 0;

  for (const fqn of HOT_TABLES) {
    const [schema, table] = fqn.split('.');
    const { rows } = await pool.query<{ fqn: string }>(LEAF_PARTITIONS_CTE, [schema, table]);

    for (const row of rows) {
      await pool.query(`ALTER TABLE ${row.fqn} SET (autovacuum_enabled = on)`);
    }

    totalAffected += rows.length;
  }

  log.info(`Re-enabled autovacuum on ${totalAffected} leaf partitions`);
}

/**
 * Exit bulk mode: create all deferred indexes, re-enable autovacuum, and vacuum analyze.
 *
 * - Sets `maintenance_work_mem = '2GB'` for faster index builds
 * - Disables statement timeout (GIN indexes on millions of rows can take 30-90 min)
 * - Creates each index sequentially with per-index timing
 * - Re-enables autovacuum on all hot-table leaf partitions
 * - Runs VACUUM ANALYZE on each hot parent table
 */
export async function bulkModeOff(pool: Pool, progressId = 'default'): Promise<void> {
  const totalStart = Date.now();

  const client = await pool.connect();
  try {
    await client.query("SET maintenance_work_mem = '2GB'");
    await client.query('SET statement_timeout = 0');
    await writeBulkModeState(client, progressId, BULK_MODE_STATES.FINALIZING);

    log.info(`Creating ${INDEXES.length} deferred indexes...`);

    for (const idx of INDEXES) {
      const start = Date.now();
      await client.query(idx.sql);
      const elapsed = ((Date.now() - start) / 1_000).toFixed(1);
      log.info(`Created index ${idx.name} (${elapsed}s)`);
    }
  } catch (error) {
    log.error(`Bulk mode finalization interrupted; state remains finalizing: ${String(error)}`);
    throw error;
  } finally {
    client.release();
  }

  await enableAutovacuum(pool);

  log.info('Running VACUUM ANALYZE on hot tables...');
  for (const fqn of HOT_TABLES) {
    await pool.query(`VACUUM ANALYZE ${fqn}`);
  }

  await writeBulkModeState(pool, progressId, BULK_MODE_STATES.FINALIZED);

  const totalElapsed = ((Date.now() - totalStart) / 1_000).toFixed(1);
  log.info(`Bulk mode OFF complete in ${totalElapsed}s`);
}

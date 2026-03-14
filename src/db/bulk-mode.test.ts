import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool, PoolClient } from 'pg';

import {
  bulkModeOff,
  detectBulkMode,
  findBulkModeOverlapTables,
  getBulkModeSafetyError,
  getBulkModeTopologyError,
} from './bulk-mode.js';

type QueryResultRow = Record<string, unknown>;
type QueryResultShape = {
  rowCount?: number;
  rows?: QueryResultRow[];
};
type QueryHandler = (sql: string, params?: unknown[]) => QueryResultShape | Promise<QueryResultShape>;

type QueryCall = {
  sql: string;
  params: unknown[] | undefined;
};

type MockPool = Pool & {
  __calls: QueryCall[];
};

function createMockPool(handler: QueryHandler): MockPool {
  const calls: QueryCall[] = [];

  const query = async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    const result = await handler(sql, params);
    return {
      rowCount: result.rowCount ?? result.rows?.length ?? 0,
      rows: result.rows ?? [],
    };
  };

  const client: Partial<PoolClient> = {
    query: query as PoolClient['query'],
    release: () => undefined,
  };

  const pool: Partial<Pool> = {
    query: query as Pool['query'],
    connect: async () => client as PoolClient,
  };

  return Object.assign(pool, { __calls: calls }) as MockPool;
}

test('detectBulkMode keeps bulk mode enabled when persisted state says finalizing', async () => {
  const pool = createMockPool((sql) => {
    if (sql.includes('SELECT last_height FROM core.indexer_progress')) {
      return { rowCount: 1, rows: [{ last_height: 1 }] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const bulkMode = await detectBulkMode(pool, 'unit-test');

  assert.equal(bulkMode, true);
  assert.equal(pool.__calls.length, 1);
});

test('detectBulkMode treats partially built deferred indexes as unfinished finalization', async () => {
  const pool = createMockPool((sql, params) => {
    if (sql.includes('SELECT last_height FROM core.indexer_progress')) {
      return { rowCount: 0, rows: [] };
    }

    if (sql.includes('WITH expected(name, table_schema, table_name)')) {
      const names = (params?.[0] as string[]) ?? [];
      return {
        rowCount: names.length,
        rows: names.map((name, index) => ({
          name,
          is_ready: index < 5,
        })),
      };
    }

    if (sql.includes('INSERT INTO core.indexer_progress')) {
      return { rowCount: 1, rows: [] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const bulkMode = await detectBulkMode(pool, 'unit-test');

  assert.equal(bulkMode, true);
  assert.ok(pool.__calls.some((call) => call.sql.includes('INSERT INTO core.indexer_progress')));
});

test('bulkModeOff brackets finalization with durable state updates', async () => {
  const pool = createMockPool((sql) => {
    if (
      sql.includes('INSERT INTO core.indexer_progress') ||
      sql.startsWith("SET maintenance_work_mem = '2GB'") ||
      sql.startsWith('SET statement_timeout = 0') ||
      sql.startsWith('VACUUM ANALYZE') ||
      sql.startsWith('ALTER TABLE') ||
      sql.startsWith('CREATE INDEX') ||
      sql.startsWith('CREATE UNIQUE INDEX')
    ) {
      return { rowCount: 0, rows: [] };
    }

    if (sql.includes('WITH RECURSIVE part_tree')) {
      return { rowCount: 0, rows: [] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  await bulkModeOff(pool, 'unit-test');

  const createIndexAt = pool.__calls.findIndex(
    (call) => call.sql.startsWith('CREATE INDEX') || call.sql.startsWith('CREATE UNIQUE INDEX'),
  );
  const progressWrites = pool.__calls
    .map((call, index) => ({ call, index }))
    .filter(({ call }) => call.sql.includes('INSERT INTO core.indexer_progress'));
  const lastVacuumAt = pool.__calls.reduce((lastIndex, call, index) => {
    return call.sql.startsWith('VACUUM ANALYZE') ? index : lastIndex;
  }, -1);

  assert.equal(progressWrites.length, 2);
  assert.ok(progressWrites[0]!.index < createIndexAt);
  assert.ok(progressWrites[1]!.index > lastVacuumAt);
});


test('getBulkModeTopologyError rejects sharded bulk mode', () => {
  assert.equal(
    getBulkModeTopologyError(2),
    'Bulk mode requires exactly one writer per database. SHARDS=2 is unsafe because deferred index finalization and autovacuum changes apply to the whole database. Re-run with SHARDS=1 until bulk mode is finalized, then restart sharded writers.',
  );
});

test('getBulkModeTopologyError allows single-writer bulk mode', () => {
  assert.equal(getBulkModeTopologyError(1), null);
});

test('findBulkModeOverlapTables reports only hot tables that already have rows in range', async () => {
  const pool = createMockPool((sql) => {
    if (sql.includes('FROM core.transactions')) {
      return { rowCount: 1, rows: [{ has_rows: true }] };
    }

    if (sql.includes('SELECT EXISTS')) {
      return { rowCount: 1, rows: [{ has_rows: false }] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const overlaps = await findBulkModeOverlapTables(pool, 9_000_000, 9_009_999);

  assert.deepEqual(overlaps, ['core.transactions']);
});

test('getBulkModeSafetyError rejects inferred bulk mode on resume runs', () => {
  assert.equal(
    getBulkModeSafetyError({
      detectionSource: 'inferred',
      resumeEnabled: true,
      hasBackfillRange: true,
      overlappingTables: [],
    }),
    'Bulk mode auto-detection is only safe for fresh non-resume backfills. Re-run with RESUME=false, or finish the existing bulk-mode lifecycle before resuming.',
  );
});

test('getBulkModeSafetyError rejects inferred bulk mode when hot tables overlap the target range', () => {
  assert.equal(
    getBulkModeSafetyError({
      detectionSource: 'inferred',
      resumeEnabled: false,
      hasBackfillRange: true,
      overlappingTables: ['core.transactions', 'core.messages'],
    }),
    'Bulk mode auto-detection found existing rows in hot tables for the requested backfill range: core.transactions, core.messages. Use a fresh/non-overlapping target or finish finalization and rerun in normal mode.',
  );
});

test('getBulkModeSafetyError allows persisted bulk-mode restarts and empty inferred ranges', () => {
  assert.equal(
    getBulkModeSafetyError({
      detectionSource: 'persisted',
      resumeEnabled: true,
      hasBackfillRange: true,
      overlappingTables: ['core.transactions'],
    }),
    null,
  );

  assert.equal(
    getBulkModeSafetyError({
      detectionSource: 'inferred',
      resumeEnabled: false,
      hasBackfillRange: false,
      overlappingTables: ['core.transactions'],
    }),
    null,
  );
});

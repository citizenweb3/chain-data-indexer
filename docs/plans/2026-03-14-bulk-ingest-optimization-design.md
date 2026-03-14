# Bulk Ingest Optimization Design

**Date**: 2026-03-14
**Branch**: `perf/throughput-experiments-20260314`
**Problem**: Indexing speed degraded from ~270 blk/s to 20-30 blk/s at 9.5M+ blocks
**Goal**: Restore backfill throughput to 150-300 blk/s

## Root Cause Analysis

Timing instrumentation from `cosmos-bugfix` branch revealed:

| Phase | Time | Bottleneck? |
|---|---|---|
| RPC fetch | 180-300ms | No |
| Decode | 80-150ms | No |
| **PG flush (insertsMs)** | **~34s per 791 blocks** | **Yes** |
| PG partitions | ~5s | Solved (partition caching in perf branch) |

34 seconds INSERT for 791 blocks = ~23 blk/s ceiling.

Root causes of slow INSERT:
1. **~30 secondary indexes** on hot tables (3 GIN: signers, jsonb_path_ops) updated on every INSERT
2. **Batched INSERT** instead of COPY FROM (SQL parsing overhead per batch)
3. **Autovacuum** competing for I/O on hot partitions
4. **Frequent checkpoints** flushing dirty pages

Sources confirming these bottlenecks:
- [PostgreSQL: Populating a Database](https://www.postgresql.org/docs/current/populate.html)
- [PostgreSQL: GIN Indexes](https://www.postgresql.org/docs/current/gin.html)
- [pganalyze: GIN Index write penalty](https://pganalyze.com/blog/gin-index)
- [Tiger Data: INSERT vs COPY benchmark](https://www.tigerdata.com/learn/testing-postgres-ingest-insert-vs-batch-insert-vs-copy)

## Solution: Automatic Bulk Mode

### Overview

No manual flags. The indexer auto-detects bulk mode by checking for the presence of
secondary indexes in `pg_indexes` at startup. Fresh DBs created with
`PG_DEFER_HEAVY_INDEXES=on` start without heavy indexes — the indexer detects this
and activates bulk mode automatically.

```
Indexer starts
    |
    +-- detectBulkMode(pool) → checks pg_indexes for key secondary indexes
    |
    +-- [indexes absent] BULK MODE
    |     +-- Disable autovacuum on all leaf partitions
    |     +-- syncRange() with COPY FROM for all tables
    |     +-- syncRange() caught up
    |           +-- bulkModeOff(pool)
    |           |     +-- CREATE INDEX (all secondary indexes)
    |           |     +-- Re-enable autovacuum on all leaf partitions
    |           |     +-- VACUUM ANALYZE on all tables
    |           +-- sink.setBulkMode(false)
    |           +-- follow.ts with normal INSERT
    |
    +-- [indexes present] NORMAL MODE
          +-- syncRange() with INSERT (ON CONFLICT)
          +-- follow.ts with INSERT
```

### Data Integrity

- **No indexes during backfill**: indexes don't store data, only accelerate SELECT. Recreating after backfill produces identical structures.
- **COPY FROM**: writes same rows to same tables via binary protocol. `dedupeCopyRows()` replaces `ON CONFLICT DO NOTHING` for restart safety (UPSERT semantics in `flushTxs` are also restart-safety only — same RPC response = same data).
- **Disable autovacuum**: does not affect data. VACUUM ANALYZE after backfill restores statistics.
- **After bulkModeOff()**: database is identical to one that was indexed with all indexes and autovacuum enabled.

## Architecture

### New Files

```
src/db/bulk-mode.ts     -- detectBulkMode() / bulkModeOff() functions
```

### Modified Files

```
src/index.ts            -- detect bulk mode at startup, call bulkModeOff() after syncRange
src/sink/types.ts       -- add setBulkMode(enabled: boolean) to Sink interface
src/sink/postgres.ts    -- implement setBulkMode(), pass { useCopy: this.bulkMode } to all flushers
src/sink/pg/flushers/blocks.ts      -- add useCopy branch
src/sink/pg/flushers/txs.ts         -- add useCopy branch
src/sink/pg/flushers/msgs.ts        -- add useCopy branch
src/sink/pg/flushers/events.ts      -- already has useCopy branch (no changes)
src/sink/pg/flushers/attrs.ts       -- already has useCopy branch (no changes)
src/sink/pg/flushers/transfers.ts   -- add useCopy branch
src/sink/pg/flushers/stake_deleg.ts -- add useCopy branch
src/sink/pg/flushers/stake_distr.ts -- add useCopy branch
src/sink/pg/flushers/wasm_exec.ts   -- add useCopy branch
src/sink/pg/flushers/wasm_events.ts -- add useCopy branch
docker-compose.prod.yaml            -- increase checkpoint_timeout, max_wal_size
```

### Removed Config

```
PG_COPY_APPEND_ONLY_TABLES  -- removed, superseded by automatic bulk mode detection
copyAppendOnlyTables         -- removed from Zod schema, PostgresSinkConfig, config.ts
```

## Component Details

### 1. bulk-mode.ts

#### detectBulkMode(pool): boolean

Queries `pg_indexes` for a representative secondary index (e.g., `idx_txs_hash`).
If absent — returns `true` (bulk mode). If present — returns `false`.

```typescript
export async function detectBulkMode(pool: Pool): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM pg_indexes WHERE indexname = 'idx_txs_hash' LIMIT 1`
  );
  const hasBulk = res.rowCount === 0;
  log.info(`[bulk-mode] detected: ${hasBulk ? 'ON (indexes absent)' : 'OFF (indexes present)'}`);
  return hasBulk;
}
```

#### disableAutovacuum(pool)

Disables autovacuum on **leaf partitions** (not parent tables — PostgreSQL applies
autovacuum settings per-partition). Uses recursive CTE from `pg_inherits` to find
all leaf tables, matching the pattern already used in `initdb/040-bootstrap-partitions.sql`:

```typescript
const HOT_TABLES = [
  'core.transactions', 'core.events', 'core.event_attrs', 'core.messages',
  'bank.transfers', 'stake.delegation_events', 'stake.distribution_events',
];

for (const table of HOT_TABLES) {
  const leaves = await client.query(`
    WITH RECURSIVE inh AS (
      SELECT c.oid, c.relkind FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = $2
      UNION ALL
      SELECT c2.oid, c2.relkind FROM inh i
      JOIN pg_inherits pi ON pi.inhparent = i.oid
      JOIN pg_class c2 ON c2.oid = pi.inhrelid
    )
    SELECT oid::regclass::text AS leaf FROM inh
    WHERE relkind = 'r'
      AND NOT EXISTS (SELECT 1 FROM pg_inherits WHERE inhparent = inh.oid)
  `, [schema, tableName]);

  for (const row of leaves.rows) {
    await client.query(`ALTER TABLE ${row.leaf} SET (autovacuum_enabled = off)`);
  }
}
```

Idempotent (safe on restart).

#### bulkModeOff(pool)

Creates indexes one by one with per-index logging. Index definitions sourced from
`initdb/010-indexer-schema.sql` and `initdb/020-patches.sql`:

```typescript
const INDEXES = [
  // core.transactions (6 indexes — includes uq_txs_height_pos, moved into defer block)
  { name: 'idx_txs_code',        sql: 'CREATE INDEX IF NOT EXISTS idx_txs_code ON core.transactions (code)' },
  { name: 'idx_txs_signers_gin', sql: 'CREATE INDEX IF NOT EXISTS idx_txs_signers_gin ON core.transactions USING GIN (signers)' },
  { name: 'idx_txs_time',        sql: 'CREATE INDEX IF NOT EXISTS idx_txs_time ON core.transactions (time DESC)' },
  { name: 'idx_txs_success',     sql: 'CREATE INDEX IF NOT EXISTS idx_txs_success ON core.transactions (height DESC, tx_index) WHERE code = 0' },
  { name: 'idx_txs_hash',        sql: 'CREATE INDEX IF NOT EXISTS idx_txs_hash ON core.transactions (tx_hash)' },
  { name: 'uq_txs_height_pos',   sql: 'CREATE UNIQUE INDEX IF NOT EXISTS uq_txs_height_pos ON core.transactions (height, tx_index)' },
  // NOTE: uq_txs_height_pos moved from unconditional to defer block in initdb.
  // Safe because: PK (height, tx_hash) guarantees row uniqueness, dedupeCopyRows handles
  // restart dedup, and tx_index is inherently unique within a block by blockchain design.
  // No ON CONFLICT or query references (height, tx_index). Atomic progress+data transactions
  // prevent partial-write conflicts on restart.
  // core.messages (4 indexes)
  { name: 'idx_msgs_height_type', sql: 'CREATE INDEX IF NOT EXISTS idx_msgs_height_type ON core.messages (height DESC, type_url)' },
  { name: 'idx_msgs_signer',      sql: 'CREATE INDEX IF NOT EXISTS idx_msgs_signer ON core.messages (signer, height DESC)' },
  { name: 'idx_msgs_value_path',  sql: 'CREATE INDEX IF NOT EXISTS idx_msgs_value_path ON core.messages USING GIN (value jsonb_path_ops)' },
  { name: 'idx_msgs_txhash_msg',  sql: 'CREATE INDEX IF NOT EXISTS idx_msgs_txhash_msg ON core.messages (tx_hash, msg_index)' },
  // core.events (2 indexes)
  { name: 'idx_events_type',     sql: 'CREATE INDEX IF NOT EXISTS idx_events_type ON core.events (event_type)' },
  { name: 'idx_events_type_msg', sql: 'CREATE INDEX IF NOT EXISTS idx_events_type_msg ON core.events (event_type, msg_index)' },
  // core.event_attrs (2 indexes — NOTE: trigram index intentionally excluded)
  { name: 'idx_event_attrs_key',            sql: 'CREATE INDEX IF NOT EXISTS idx_event_attrs_key ON core.event_attrs (key)' },
  { name: 'idx_event_attrs_key_value_md5',  sql: `CREATE INDEX IF NOT EXISTS idx_event_attrs_key_value_md5 ON core.event_attrs (key, md5(COALESCE(value, '')))` },
  // bank.transfers (4 indexes)
  { name: 'idx_transfers_from',        sql: 'CREATE INDEX IF NOT EXISTS idx_transfers_from ON bank.transfers (from_addr, height DESC)' },
  { name: 'idx_transfers_to',          sql: 'CREATE INDEX IF NOT EXISTS idx_transfers_to ON bank.transfers (to_addr, height DESC)' },
  { name: 'idx_transfers_denom',       sql: 'CREATE INDEX IF NOT EXISTS idx_transfers_denom ON bank.transfers (denom)' },
  { name: 'idx_transfers_brin_height', sql: 'CREATE INDEX IF NOT EXISTS idx_transfers_brin_height ON bank.transfers USING BRIN (height)' },
  // stake.delegation_events (3 indexes)
  { name: 'idx_del_ev_delegator', sql: 'CREATE INDEX IF NOT EXISTS idx_del_ev_delegator ON stake.delegation_events (delegator_address, height DESC)' },
  { name: 'idx_del_ev_valdst',    sql: 'CREATE INDEX IF NOT EXISTS idx_del_ev_valdst ON stake.delegation_events (validator_dst, height DESC)' },
  { name: 'idx_del_ev_valsrc',    sql: 'CREATE INDEX IF NOT EXISTS idx_del_ev_valsrc ON stake.delegation_events (validator_src, height DESC)' },
  // stake.distribution_events (2 indexes)
  { name: 'idx_dist_ev_validator', sql: 'CREATE INDEX IF NOT EXISTS idx_dist_ev_validator ON stake.distribution_events (validator_address, height DESC)' },
  { name: 'idx_dist_ev_delegator', sql: 'CREATE INDEX IF NOT EXISTS idx_dist_ev_delegator ON stake.distribution_events (delegator_address, height DESC)' },
  // gov (3 indexes)
  { name: 'idx_gov_status',       sql: 'CREATE INDEX IF NOT EXISTS idx_gov_status ON gov.proposals (status)' },
  { name: 'idx_gov_dep_depositor', sql: 'CREATE INDEX IF NOT EXISTS idx_gov_dep_depositor ON gov.deposits (depositor, height DESC)' },
  { name: 'idx_gov_votes_voter',   sql: 'CREATE INDEX IF NOT EXISTS idx_gov_votes_voter ON gov.votes (voter, height DESC)' },
  { name: 'idx_gov_votes_prop',    sql: 'CREATE INDEX IF NOT EXISTS idx_gov_votes_prop ON gov.votes (proposal_id, option)' },
  // wasm.executions (4 indexes)
  { name: 'idx_wasm_exec_contract', sql: 'CREATE INDEX IF NOT EXISTS idx_wasm_exec_contract ON wasm.executions (contract, height DESC)' },
  { name: 'idx_wasm_exec_msg_gin',  sql: 'CREATE INDEX IF NOT EXISTS idx_wasm_exec_msg_gin ON wasm.executions USING GIN (msg jsonb_path_ops)' },
  { name: 'idx_wasm_exec_success',  sql: 'CREATE INDEX IF NOT EXISTS idx_wasm_exec_success ON wasm.executions (success)' },
  { name: 'idx_wasm_exec_tx_msg',   sql: 'CREATE INDEX IF NOT EXISTS idx_wasm_exec_tx_msg ON wasm.executions (tx_hash, msg_index)' },
  // wasm.events (3 indexes)
  { name: 'idx_wasm_events_contract', sql: 'CREATE INDEX IF NOT EXISTS idx_wasm_events_contract ON wasm.events (contract, height DESC)' },
  { name: 'idx_wasm_events_type',     sql: 'CREATE INDEX IF NOT EXISTS idx_wasm_events_type ON wasm.events (event_type)' },
  { name: 'idx_wasm_events_tx_msg',   sql: 'CREATE INDEX IF NOT EXISTS idx_wasm_events_tx_msg ON wasm.events (tx_hash, msg_index)' },
];
```

**Note**: `idx_event_attrs_value_trgm` (GIN trigram) is intentionally excluded — it was
disabled in `010-indexer-schema.sql` due to 10-second insert pauses.

After index creation:
1. Re-enable autovacuum on all leaf partitions (reverse of `disableAutovacuum`)
2. Run `VACUUM ANALYZE` on each hot table

Index creation on 9.5M+ blocks with 3 GIN indexes can realistically take **30-90 minutes**.
Set `maintenance_work_mem` at session level before creating indexes for faster builds:

```sql
SET maintenance_work_mem = '2GB';
```

### 2. Flusher COPY FROM Pattern

Each flusher gets `opts?: { useCopy?: boolean }`. The `events.ts` and `attrs.ts`
flushers already have this branch — no changes needed for those two.

For all other flushers, add the useCopy branch:

```typescript
export async function flushTxs(
  client: PoolClient,
  rows: any[],
  opts?: { useCopy?: boolean }
): Promise<void> {
  if (!rows.length) return;
  if (opts?.useCopy) {
    const deduped = dedupeCopyRows(rows, (r) => `${r.height}\x1f${r.tx_hash}`);
    await execCopyFrom(client, 'core.transactions', [
      { name: 'tx_hash', value: (r) => r.tx_hash },
      { name: 'height', value: (r) => r.height },
      { name: 'tx_index', value: (r) => r.tx_index },
      { name: 'code', value: (r) => r.code },
      { name: 'gas_wanted', value: (r) => r.gas_wanted },
      { name: 'gas_used', value: (r) => r.gas_used },
      { name: 'fee', value: (r) => r.fee },
      { name: 'memo', value: (r) => r.memo },
      { name: 'signers', value: (r) => r.signers },
      { name: 'raw_tx', value: (r) => r.raw_tx },
      { name: 'log_summary', value: (r) => r.log_summary },
      { name: 'time', value: (r) => r.time },
    ], deduped);
    return;
  }
  // existing INSERT code unchanged
}
```

Dedup keys must match primary keys:

| Flusher | PK | Dedup key |
|---|---|---|
| flushBlocks | `(height)` | `${r.height}` |
| flushTxs | `(height, tx_hash)` | `${r.height}\x1f${r.tx_hash}` |
| flushMsgs | `(height, tx_hash, msg_index)` | `${r.height}\x1f${r.tx_hash}\x1f${r.msg_index}` |
| flushEvents | `(height, tx_hash, msg_index, event_index)` | already implemented |
| flushAttrs | `(height, tx_hash, msg_index, event_index, key)` | already implemented |
| flushTransfers | `(height, tx_hash, msg_index, from_addr, to_addr, denom)` | `${r.height}\x1f${r.tx_hash}\x1f${r.msg_index}\x1f${r.from_addr}\x1f${r.to_addr}\x1f${r.denom}` |
| flushStakeDeleg | `(height, tx_hash, msg_index)` | `${r.height}\x1f${r.tx_hash}\x1f${r.msg_index}` |
| flushStakeDistr | `(height, tx_hash, msg_index)` | `${r.height}\x1f${r.tx_hash}\x1f${r.msg_index}` |
| flushWasmExec | `(height, tx_hash, msg_index)` | `${r.height}\x1f${r.tx_hash}\x1f${r.msg_index}` |
| flushWasmEvents | `(height, tx_hash, msg_index, event_type)` | `${r.height}\x1f${r.tx_hash}\x1f${r.msg_index}\x1f${r.event_type}` |

Tables requiring JSONB serialization (txs, msgs, wasm_exec, wasm_events) use
`stringifyCopyJson()` from `copy.ts` for JSONB columns. Already handles bigint,
Uint8Array, Buffer, and Date.

### 3. flushAll() Integration

In `src/sink/postgres.ts` `flushAll()` method:

```typescript
const copyOpts = { useCopy: this.bulkMode };

await timeFlush('blocks', () => flushBlocks(client, this.bufBlocks, copyOpts));
await timeFlush('txs', () => flushTxs(client, this.bufTxs, copyOpts));
await timeFlush('msgs', () => flushMsgs(client, this.bufMsgs, copyOpts));
await timeFlush('events', () => flushEvents(client, this.bufEvents, copyOpts));
await timeFlush('attrs', () => flushAttrs(client, this.bufAttrs, copyOpts));
await timeFlush('transfers', () => flushTransfers(client, this.bufTransfers, copyOpts));
await timeFlush('stakeDeleg', () => flushStakeDeleg(client, this.bufStakeDeleg, copyOpts));
await timeFlush('stakeDistr', () => flushStakeDistr(client, this.bufStakeDistr, copyOpts));
await timeFlush('wasmExec', () => flushWasmExec(client, this.bufWasmExec, copyOpts));
await timeFlush('wasmEvents', () => flushWasmEvents(client, this.bufWasmEvents, copyOpts));
await timeFlush('govDeposits', () => flushGovDeposits(client, this.bufGovDeposits));
await timeFlush('govVotes', () => flushGovVotes(client, this.bufGovVotes));
await timeFlush('govProposals', () => upsertGovProposals(client, this.bufGovProposals));
```

Gov flushers keep INSERT — gov tables are tiny (hundreds of rows), not worth COPY overhead.

### 4. Sink setBulkMode()

Add `setBulkMode(enabled: boolean)` to `Sink` interface (no-op by default).
`PostgresSink` implements it to switch `this.bulkMode`:

```typescript
// src/sink/types.ts
export interface Sink {
  init(): Promise<void>;
  write(line: unknown): Promise<void>;
  flush?(): Promise<void>;
  close(): Promise<void>;
  setBulkMode?(enabled: boolean): void;  // new
}

// src/sink/postgres.ts
setBulkMode(enabled: boolean): void {
  this.bulkMode = enabled;
  log.info(`[sink] bulk mode ${enabled ? 'ON' : 'OFF'}`);
}
```

### 5. index.ts Integration

```typescript
async function main() {
  const cfg = getConfig();
  // ... existing init code ...

  const sink = createSink({ ... });
  await sink.init();

  // Auto-detect bulk mode from DB state
  const pool = getPgPool();
  const bulkMode = await detectBulkMode(pool);
  if (bulkMode) {
    await disableAutovacuum(pool);
    sink.setBulkMode?.(true);
    log.info('[bulk-mode] COPY FROM enabled, autovacuum disabled');
  }

  const backfill = await syncRange(rpc, decodePool, sink, { ... });

  // Transition: create indexes and switch to INSERT
  if (bulkMode) {
    await bulkModeOff(pool);    // CREATE INDEX, re-enable autovacuum, VACUUM ANALYZE
    sink.setBulkMode?.(false);  // switch sink to INSERT mode
  }

  if (cfg.follow !== false) {
    await followLoop(rpc, decodePool, sink, { ... });
  }

  // ... existing cleanup ...
}
```

### 6. Docker Compose PG Tuning

In `docker-compose.prod.yaml`, increase WAL settings:

```yaml
- "-c"
- "checkpoint_timeout=30min"     # add (default 5min is too aggressive for bulk writes)
- "-c"
- "max_wal_size=32GB"            # increase from 16GB
```

### 7. Configuration Cleanup

Remove `PG_COPY_APPEND_ONLY_TABLES` from:
- `src/config.ts` — remove `copyAppendOnlyTables` parsing
- `src/config/schema.ts` — remove from PgConfigSchema
- `src/sink/postgres.ts` — remove `copyAppendOnlyTables` field, replace with `bulkMode`

No new env vars needed — bulk mode is fully automatic.

## Edge Cases

### Crash During Backfill

1. Indexes are already absent (deferred at initdb or never created)
2. `disableAutovacuum()` is idempotent (`ALTER TABLE SET` safe on repeat)
3. syncRange resumes from `core.indexer_progress` last height
4. `dedupeCopyRows()` handles boundary block deduplication within batch
5. Progress update and data insert are in the same transaction — atomic

### Crash During bulkModeOff() (Index Creation)

1. Indexer restarts
2. `detectBulkMode()` finds indexes still absent → bulk mode ON
3. syncRange resumes — chain already caught up, processes 0 blocks
4. `bulkModeOff()` retries — `CREATE INDEX IF NOT EXISTS` is idempotent
5. Partially created indexes are completed, not duplicated

### New Partitions Created During Backfill

Secondary indexes were dropped on parent partitioned table. New partitions created by
`ensureCorePartitions()` will not have secondary indexes — correct behavior.
`bulkModeOff()` creates indexes on parent, PostgreSQL automatically applies to all partitions.

### Restart With Indexes Present (Normal Mode)

If indexes exist (previous backfill completed), `detectBulkMode()` returns `false`.
Indexer uses INSERT as usual — no index manipulation, no autovacuum changes.

## Testing Plan

1. **Detection**: fresh DB with `PG_DEFER_HEAVY_INDEXES=on` → `detectBulkMode()` returns true
2. **Detection**: DB after completed backfill → `detectBulkMode()` returns false
3. **Autovacuum**: `disableAutovacuum()` twice — no errors (idempotent)
4. **Full cycle**: detect bulk → COPY 100 blocks → bulkModeOff → verify all indexes exist, SELECT queries work
5. **Restart**: insert 50 blocks, kill process, restart — continues from block 51 in bulk mode
6. **Follow transition**: after bulkModeOff, sink uses INSERT not COPY
7. **Leaf partitions**: verify autovacuum disabled/enabled on actual leaf partitions, not just parent

## Success Metrics

- Backfill from block 0: **>100 blk/s** sustained (current: 20-30 at 9.5M+)
- `insertsMs` in logs: **<5s per 1000 blocks** (current: ~34s per 791)
- `partitionsMs`: ~0ms (already solved by partition caching)
- After bulkModeOff: all explorer API SELECT queries work correctly
- Index creation time: ~30-90 min for 9.5M+ blocks (one-time cost)

## Expected Impact by Optimization

| # | Optimization | Expected speedup | Complexity |
|---|---|---|---|
| 1 | Skip ~30 secondary indexes (3 GIN, ~27 B-tree) | **3-10x** | SQL list in bulk-mode.ts |
| 2 | COPY FROM for all hot tables | **3-5x** | Extend existing copy.ts |
| 3 | Disable autovacuum on leaf partitions | **1.2-1.5x** | Recursive ALTER in bulk-mode.ts |
| 4 | checkpoint_timeout=30min, max_wal_size=32GB | **1.1-1.3x** | docker-compose only |

Combined expected result: **150-300 blk/s** from current 20-30 blk/s.

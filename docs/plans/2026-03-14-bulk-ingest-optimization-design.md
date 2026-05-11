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
1. **30 secondary indexes** on hot tables (3 GIN including trigram, jsonb_path_ops) updated on every INSERT
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

New `PG_BULK_MODE=true` env flag enables automatic lifecycle:

```
Indexer starts with PG_BULK_MODE=true
    |
    +-- bulkModeOn(pool)
    |     +-- DROP INDEX (30 secondary indexes)
    |     +-- ALTER TABLE ... SET (autovacuum_enabled = off)
    |
    +-- syncRange() with COPY FROM for all tables
    |     +-- flushAll() -> execCopyFrom() instead of execBatchedInsert()
    |
    +-- syncRange() caught up -> transition to follow
          +-- bulkModeOff(pool)
          |     +-- CREATE INDEX (all 30 indexes)
          |     +-- ALTER TABLE ... SET (autovacuum_enabled = on)
          |     +-- VACUUM ANALYZE on all tables
          |
          +-- follow.ts with normal INSERT (bulkMode = false)
```

### Data Integrity

- **Drop indexes**: indexes don't store data, only accelerate SELECT. Recreating after backfill produces identical structures.
- **COPY FROM**: writes same rows to same tables via binary protocol. `dedupeCopyRows()` replaces `ON CONFLICT DO NOTHING` for restart safety.
- **Disable autovacuum**: does not affect data. VACUUM ANALYZE after backfill restores statistics.
- **After bulkModeOff()**: database is identical to one that was indexed with all indexes and autovacuum enabled.

## Architecture

### New Files

```
src/db/bulk-mode.ts     -- bulkModeOn() / bulkModeOff() functions
```

### Modified Files

```
src/config.ts           -- add bulkMode config
src/config/schema.ts    -- add PG_BULK_MODE to Zod schema
src/index.ts            -- call bulkModeOn() at startup when enabled
src/runner/follow.ts    -- call bulkModeOff() before entering follow loop
src/sink/postgres.ts    -- pass { useCopy: this.bulkMode } to all flushers
src/sink/pg/copy.ts     -- already exists, no changes needed
src/sink/pg/flushers/blocks.ts      -- add useCopy branch
src/sink/pg/flushers/txs.ts         -- add useCopy branch
src/sink/pg/flushers/msgs.ts        -- add useCopy branch
src/sink/pg/flushers/transfers.ts   -- add useCopy branch
src/sink/pg/flushers/stake_deleg.ts -- add useCopy branch
src/sink/pg/flushers/stake_distr.ts -- add useCopy branch
src/sink/pg/flushers/wasm_exec.ts   -- add useCopy branch
src/sink/pg/flushers/wasm_events.ts -- add useCopy branch
docker-compose.prod.yaml            -- checkpoint_timeout, max_wal_size
```

## Component Details

### 1. bulk-mode.ts

#### bulkModeOn(pool)

Executes in a single transaction:

```sql
BEGIN;
DROP INDEX IF EXISTS core.idx_txs_code;
DROP INDEX IF EXISTS core.idx_txs_signers_gin;
DROP INDEX IF EXISTS core.idx_txs_time;
DROP INDEX IF EXISTS core.idx_txs_success;
DROP INDEX IF EXISTS core.idx_txs_hash;
DROP INDEX IF EXISTS core.idx_msgs_height_type;
DROP INDEX IF EXISTS core.idx_msgs_signer;
DROP INDEX IF EXISTS core.idx_msgs_value_path;
DROP INDEX IF EXISTS core.idx_msgs_txhash_msg;
DROP INDEX IF EXISTS core.idx_events_type;
DROP INDEX IF EXISTS core.idx_event_attrs_key;
DROP INDEX IF EXISTS core.idx_event_attrs_key_value_md5;
DROP INDEX IF EXISTS core.idx_event_attrs_value_trgm;
DROP INDEX IF EXISTS bank.idx_transfers_from;
DROP INDEX IF EXISTS bank.idx_transfers_to;
DROP INDEX IF EXISTS bank.idx_transfers_denom;
DROP INDEX IF EXISTS bank.idx_transfers_brin_height;
DROP INDEX IF EXISTS stake.idx_del_ev_delegator;
DROP INDEX IF EXISTS stake.idx_del_ev_valdst;
DROP INDEX IF EXISTS stake.idx_del_ev_valsrc;
DROP INDEX IF EXISTS stake.idx_dist_ev_validator;
DROP INDEX IF EXISTS stake.idx_dist_ev_delegator;
DROP INDEX IF EXISTS gov.idx_gov_status;
DROP INDEX IF EXISTS gov.idx_gov_dep_depositor;
DROP INDEX IF EXISTS gov.idx_gov_votes_voter;
DROP INDEX IF EXISTS gov.idx_gov_votes_prop;
DROP INDEX IF EXISTS wasm.idx_wasm_exec_contract;
DROP INDEX IF EXISTS wasm.idx_wasm_exec_msg_gin;
DROP INDEX IF EXISTS wasm.idx_wasm_exec_success;
DROP INDEX IF EXISTS wasm.idx_wasm_exec_tx_msg;
DROP INDEX IF EXISTS wasm.idx_wasm_events_contract;
DROP INDEX IF EXISTS wasm.idx_wasm_events_type;
DROP INDEX IF EXISTS wasm.idx_wasm_events_tx_msg;
COMMIT;
```

Then disables autovacuum:

```sql
ALTER TABLE core.transactions SET (autovacuum_enabled = off);
ALTER TABLE core.events SET (autovacuum_enabled = off);
ALTER TABLE core.event_attrs SET (autovacuum_enabled = off);
ALTER TABLE core.messages SET (autovacuum_enabled = off);
ALTER TABLE bank.transfers SET (autovacuum_enabled = off);
ALTER TABLE stake.delegation_events SET (autovacuum_enabled = off);
ALTER TABLE stake.distribution_events SET (autovacuum_enabled = off);
```

Both operations are idempotent (safe on restart).

#### bulkModeOff(pool)

Creates indexes one by one with per-index logging (can take 10-30 min on 9.5M+ blocks):

```typescript
const INDEXES = [
  { name: 'idx_txs_code', sql: 'CREATE INDEX IF NOT EXISTS idx_txs_code ON core.transactions (code)' },
  // ... all 30 indexes from rebuild-heavy-indexes.sql
];

for (const idx of INDEXES) {
  log.info(`creating index ${idx.name}...`);
  await client.query(idx.sql);
  log.info(`index ${idx.name} created`);
}
```

Then re-enables autovacuum and runs VACUUM ANALYZE on each table.

### 2. Flusher COPY FROM Pattern

Each flusher gets `opts?: { useCopy?: boolean }`:

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
      // ... all columns
    ], deduped);
    return;
  }
  // existing INSERT code unchanged
}
```

Tables requiring JSONB serialization (txs, msgs, wasm_exec, wasm_events) use
`stringifyCopyJson()` from `copy.ts` for JSONB columns. Already handles bigint,
Uint8Array, Buffer, and Date.

### 3. flushAll() Integration

In `src/sink/postgres.ts` `flushAll()` method:

```typescript
const copyOpts = { useCopy: this.bulkMode };

await flushBlocks(client, this.bufBlocks, copyOpts);
await flushTxs(client, this.bufTxs, copyOpts);
await flushMsgs(client, this.bufMsgs, copyOpts);
await flushEvents(client, this.bufEvents, copyOpts);
await flushAttrs(client, this.bufAttrs, copyOpts);
await flushTransfers(client, this.bufTransfers, copyOpts);
await flushStakeDeleg(client, this.bufStakeDeleg, copyOpts);
await flushStakeDistr(client, this.bufStakeDistr, copyOpts);
await flushWasmExec(client, this.bufWasmExec, copyOpts);
await flushWasmEvents(client, this.bufWasmEvents, copyOpts);
```

### 4. Docker Compose PG Tuning

In `docker-compose.prod.yaml`, add to PostgreSQL command:

```yaml
-c checkpoint_timeout=30min
-c max_wal_size=32GB
```

Existing settings already present: `synchronous_commit=off`, `wal_level=minimal`.

### 5. Configuration

New env var in `.env.example`:

```
PG_BULK_MODE=false   # Set to true for initial backfill, auto-restores on follow
```

Zod schema addition:

```typescript
bulkMode: z.boolean().default(false),
```

## Edge Cases

### Crash During Backfill

1. `bulkModeOn()` is idempotent: `DROP INDEX IF EXISTS`, `ALTER TABLE SET` safe on repeat
2. syncRange resumes from `core.indexer_progress` last height
3. `dedupeCopyRows()` handles boundary block deduplication

### Crash During bulkModeOff() (Index Creation)

1. Restart with `PG_BULK_MODE=true`
2. `bulkModeOn()` drops partially created indexes
3. syncRange finds chain already caught up
4. Immediately calls `bulkModeOff()` — indexes recreated from scratch

### New Partitions Created During Backfill

Secondary indexes were dropped on parent partitioned table. New partitions created by
`ensureCorePartitions()` will not have secondary indexes — correct behavior.
`bulkModeOff()` recreates indexes on parent, automatically applies to all partitions.

### COPY FROM Duplicate Key

syncRange guarantees ordered sequential flush — each height processed exactly once.
`dedupeCopyRows()` is second barrier for restart edge case.
If duplicate still occurs: PostgreSQL raises error, transaction rolls back,
syncRange retries the height.

## Testing Plan

1. **Idempotency**: run `bulkModeOn()` twice — no errors
2. **Full cycle**: bulkModeOn -> COPY 100 blocks -> bulkModeOff -> verify all indexes exist, SELECT queries work
3. **Restart**: insert 50 blocks, kill process, restart — continues from block 51
4. **Follow transition**: after bulkModeOff, sink uses INSERT not COPY

## Success Metrics

- Backfill from block 9,000,000: **>100 blk/s** (current: 20-30)
- `insertsMs` in logs: **<5s per 1000 blocks** (current: ~34s per 791)
- `partitionsMs`: ~0ms (already solved by partition caching)
- After bulkModeOff: all explorer API SELECT queries work correctly

## Expected Impact by Optimization

| # | Optimization | Expected speedup | Complexity |
|---|---|---|---|
| 1 | Drop 30 secondary indexes (especially 3 GIN) | **3-10x** | SQL list in bulk-mode.ts |
| 2 | COPY FROM for all tables | **3-5x** | Extend existing copy.ts |
| 3 | Disable autovacuum on hot tables | **1.2-1.5x** | SQL in bulk-mode.ts |
| 4 | checkpoint_timeout=30min, max_wal_size=32GB | **1.1-1.3x** | docker-compose only |

Combined expected result: **150-300 blk/s** from current 20-30 blk/s.

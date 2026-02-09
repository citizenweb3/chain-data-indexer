# Database Module

**Purpose:** PostgreSQL utilities — connection pooling, partition management, and progress tracking for resumable indexing.

## Key Files

| File | Description |
|------|-------------|
| `pg.ts` | Connection pool singleton — create, get, close |
| `partitions.ts` | Range and hash partition creation for all tables |
| `progress.ts` | Indexer progress tracking (last processed height) |

## Dependencies

- `pg` — PostgreSQL client library
- Uses advisory locks for partition creation safety

## Used By

- `src/index.ts` — Creates pool for progress resolution
- `src/sink/postgres.ts` — Uses pool for data insertion
- `src/sink/postgres.ts` → `ensureCorePartitions()` before inserts
- `src/sink/postgres.ts` → `upsertProgress()` after batch commits

## Structure

```
src/db/
├── pg.ts           # Pool singleton management
├── partitions.ts   # Partition DDL generation
└── progress.ts     # Progress read/write
```

## Connection Pool (`pg.ts`)

### Configuration
```typescript
type PgConfig = {
  connectionString?: string;  // Full postgres:// URL
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean;
  applicationName?: string;   // Default: 'cosmos-indexer'
  poolSize?: number;          // Default: 16
};
```

### Functions
```typescript
// Create singleton pool (idempotent)
createPgPool(cfg: PgConfig): Pool

// Get existing pool (throws if not initialized)
getPgPool(): Pool

// Close pool and release connections
closePgPool(): Promise<void>
```

### Pool Settings
```typescript
const pool = new Pool({
  // ... connection params
  max: poolSize ?? 16,
  idleTimeoutMillis: 30_000,
  application_name: 'cosmos-indexer',
});
```

## Partitioning (`partitions.ts`)

### Partition Strategy

**Range Partitions** (by height, 1M blocks per partition):
- `core.blocks`
- `core.transactions`
- `core.messages`
- `bank.transfers`
- `stake.delegation_events`
- `stake.distribution_events`
- `gov.deposits`
- `gov.votes`
- `wasm.executions`
- `wasm.events`
- ... and more

**Hash Partitions** (by modulus, default 16):
- `core.events` (high volume, hash distributed)

### Main Function
```typescript
async function ensureCorePartitions(
  client: PoolClient,
  minH: number,
  maxH?: number
): Promise<void>
```

### Partition Creation Flow
```
ensureCorePartitions(client, minH=1500000, maxH=2500000)
    │
    ├── Acquire advisory lock (prevents concurrent DDL)
    │
    ├── ensureEventsHashPartitions()
    │   └── Creates core.events_h00 through core.events_h15
    │
    ├── For each 1M range covering [minH, maxH]:
    │   └── createRangePartition(schema, table, from, to)
    │       └── CREATE TABLE IF NOT EXISTS schema.table_p{from}
    │           PARTITION OF schema.table
    │           FOR VALUES FROM ({from}) TO ({to})
    │
    └── Release advisory lock
```

### Partition Naming
```
core.blocks_p0         →  heights [0, 1000000)
core.blocks_p1000000   →  heights [1000000, 2000000)
core.blocks_p2000000   →  heights [2000000, 3000000)

core.events_h00        →  hash modulus 16, remainder 0
core.events_h01        →  hash modulus 16, remainder 1
...
core.events_h15        →  hash modulus 16, remainder 15
```

## Progress Tracking (`progress.ts`)

### Schema
```sql
-- core.indexer_progress
CREATE TABLE core.indexer_progress (
  id VARCHAR PRIMARY KEY,      -- e.g., 'default', 'shard-0'
  last_height BIGINT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### Functions
```typescript
// Read last processed height
async function getProgress(
  poolOrClient: Pool | PoolClient,
  id: string
): Promise<number | null>

// Upsert progress (INSERT ... ON CONFLICT UPDATE)
async function upsertProgress(
  client: PoolClient,
  id: string,
  lastHeight: number
): Promise<void>
```

### Usage Pattern
```typescript
// At startup: resolve starting height
const last = await getProgress(pool, cfg.pg.progressId ?? 'default');
const startFrom = last != null ? last + 1 : cfg.firstBlock;

// After each batch commit
await upsertProgress(client, progressId, maxHeight);
```

## Common Patterns

### 1. Initialize Pool at Startup
```typescript
import { createPgPool, closePgPool } from './db/pg.js';

const pool = createPgPool({
  host: cfg.pg.host,
  port: cfg.pg.port,
  user: cfg.pg.user,
  password: cfg.pg.password,
  database: cfg.pg.database,
  ssl: cfg.pg.ssl,
  applicationName: 'cosmos-indexer',
  poolSize: 16,
});

// ... use pool ...

await closePgPool();
```

### 2. Ensure Partitions Before Insert
```typescript
const client = await pool.connect();
try {
  await ensureCorePartitions(client, minHeight, maxHeight);
  await client.query('BEGIN');
  // ... inserts ...
  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
} finally {
  client.release();
}
```

### 3. Progress-Based Resume
```typescript
const last = await getProgress(pool, 'default');
if (last !== null) {
  console.log(`Resuming from height ${last + 1}`);
}
```

## Advisory Locking

Prevents race conditions during partition creation:

```typescript
// Lock ID: 0x70617274 = 'part' in hex
await client.query(`SELECT pg_advisory_lock($1)`, [0x70617274]);
try {
  // ... create partitions ...
} finally {
  await client.query(`SELECT pg_advisory_unlock($1)`, [0x70617274]);
}
```

## Supported Tables for Partitioning

```typescript
const RANGE_TABLES = [
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
```

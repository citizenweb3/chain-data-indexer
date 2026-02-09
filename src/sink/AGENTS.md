# Sink Module

**Purpose:** Output backends for persisting indexed blockchain data. Implements factory pattern with multiple sink types: stdout, file, postgres, clickhouse, null.

## Key Files

| File | Description |
|------|-------------|
| `index.ts` | Factory function `createSink()` — selects sink by config |
| `types.ts` | `Sink` interface, `SinkConfig`, `SinkKind` types |
| `stdout.ts` | JSON lines to console |
| `file.ts` | Appends JSONL to file |
| `postgres.ts` | Batched inserts to PostgreSQL with domain extractors |
| `clickhouse.ts` | Columnar analytics (placeholder) |
| `null.ts` | No-op sink for testing |
| `pg/` | PostgreSQL-specific inserters, flushers, parsing |

## Dependencies

- `pg` — PostgreSQL client (via `../db/pg.js`)
- `../db/partitions.js` — Partition management
- `../db/progress.js` — Progress tracking
- `../utils/logger.js` — Winston logging

## Used By

- `src/index.ts` — Creates sink from config
- `src/runner/syncRange.ts` — Writes assembled blocks
- `src/runner/follow.ts` — Writes blocks, calls flush

## Structure

```
src/sink/
├── index.ts          # createSink() factory
├── types.ts          # Sink interface and config types
├── stdout.ts         # StdoutSink class
├── file.ts           # FileSink class
├── postgres.ts       # PostgresSink class (main implementation)
├── clickhouse.ts     # ClickhouseSink class (placeholder)
├── null.ts           # NullSink class
└── pg/
    ├── batch.ts      # makeMultiInsert(), execBatchedInsert()
    ├── parsing.ts    # Row extraction helpers
    ├── flushers/     # Batch flush functions per entity
    │   ├── blocks.ts
    │   ├── txs.ts
    │   ├── msgs.ts
    │   ├── events.ts
    │   ├── attrs.ts
    │   ├── transfers.ts
    │   ├── stake_deleg.ts
    │   ├── stake_distr.ts
    │   ├── wasm_exec.ts
    │   ├── wasm_events.ts
    │   └── gov.ts
    └── inserters/    # Single-row insert functions
        ├── blocks.ts
        ├── txs.ts
        ├── msgs.ts
        ├── events.ts
        └── ...
```

## Sink Interface (`types.ts`)

```typescript
interface Sink {
  init(): Promise<void>;           // Initialize resources
  write(line: any): Promise<void>; // Write a single block
  flush?(): Promise<void>;         // Flush buffered data
  close(): Promise<void>;          // Release resources
}
```

## Sink Kinds

| Kind | Class | Description |
|------|-------|-------------|
| `stdout` | `StdoutSink` | Writes JSON lines to console |
| `file` | `FileSink` | Appends JSONL to file path |
| `postgres` | `PostgresSink` | Batched inserts to PostgreSQL |
| `clickhouse` | `ClickhouseSink` | Columnar DB (placeholder) |
| `null` | `NullSink` | Discards all data (testing) |

## Factory Pattern (`index.ts`)

```typescript
function createSink(cfg: SinkConfig): Sink {
  switch (cfg.kind) {
    case 'stdout':    return new StdoutSink(cfg);
    case 'file':      return new FileSink(cfg);
    case 'postgres':  return new PostgresSink({ ... });
    case 'clickhouse': return new ClickhouseSink(cfg);
    case 'null':      return new NullSink();
    default: throw new Error(`Unknown sink kind: ${cfg.kind}`);
  }
}
```

## PostgresSink — Main Implementation

### Modes
- `batch-insert`: Buffer rows, flush in batches (default, recommended)
- `block-atomic`: Write each block in a single transaction

### Configuration
```typescript
interface PostgresSinkConfig {
  pg: {
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
    ssl?: boolean;
    progressId?: string;  // For resume tracking
  };
  mode?: 'batch-insert' | 'block-atomic';
  batchSizes?: {
    blocks?: number;   // default: 1000
    txs?: number;      // default: 2000
    msgs?: number;     // default: 5000
    events?: number;   // default: 5000
    attrs?: number;    // default: 10000
  };
}
```

### Row Extraction (`extractRows`)

Transforms `BlockJson` into row arrays for each table:

```typescript
{
  blockRow,        // core.blocks
  txRows,          // core.transactions
  msgRows,         // core.messages
  evRows,          // core.events
  attrRows,        // core.event_attributes
  transfersRows,   // bank.transfers
  stakeDelegRows,  // stake.delegation_events
  stakeDistrRows,  // stake.distribution_events
  wasmExecRows,    // wasm.executions
  wasmEventsRows,  // wasm.events
  govDepositsRows, // gov.deposits
  govVotesRows,    // gov.votes
  govProposalsRows // gov.proposals
}
```

### Flush Flow

```
persistBlockBuffered(blockLine)
    │
    ├── extractRows(blockLine)
    ├── Push to buffers (bufBlocks, bufTxs, ...)
    │
    └── If any buffer >= threshold:
        └── flushAll()
            ├── ensureCorePartitions(minH, maxH)
            ├── BEGIN transaction
            ├── flushBlocks(client, bufBlocks)
            ├── flushTxs(client, bufTxs)
            ├── flushMsgs(client, bufMsgs)
            ├── flushEvents(client, bufEvents)
            ├── flushAttrs(client, bufAttrs)
            ├── flushTransfers(...)
            ├── flushStakeDeleg(...)
            ├── flushStakeDistr(...)
            ├── flushWasmExec(...)
            ├── flushWasmEvents(...)
            ├── flushGovDeposits(...)
            ├── flushGovVotes(...)
            ├── upsertGovProposals(...)
            ├── upsertProgress(progressId, maxH)
            └── COMMIT
```

## PostgreSQL Helpers (`pg/`)

### Batch Insert (`batch.ts`)
```typescript
// Handles PostgreSQL's 65535 parameter limit
await execBatchedInsert(client, rows, (chunk) => insertFn(client, chunk));
```

### Parsing Helpers (`parsing.ts`)
```typescript
normArray(x)           // Ensure array
pickMessages(tx)       // Extract messages from tx
pickLogs(tx)           // Extract logs from tx
attrsToPairs(attrs)    // Convert attrs to [{key, value}]
parseCoin(str)         // Parse "1000uatom" to {amount, denom}
findAttr(pairs, key)   // Find attribute by key
collectSignersFromMessages(msgs)  // Extract signers
buildFeeFromDecodedFee(fee)       // Build fee object
```

## Common Patterns

### 1. Creating Sink
```typescript
const sink = createSink({
  kind: 'postgres',
  pg: cfg.pg,
  batchSizes: {
    blocks: 1000,
    txs: 2000,
    msgs: 5000,
    events: 5000,
  },
});
await sink.init();
```

### 2. Writing Blocks
```typescript
await sink.write(blockJson);  // Buffered internally
await sink.flush();           // Force flush to DB
await sink.close();           // Cleanup
```

### 3. Domain-Specific Extraction
```typescript
// Transfer extraction from events
if (event_type === 'transfer') {
  const sender = findAttr(attrsPairs, 'sender');
  const recipient = findAttr(attrsPairs, 'recipient');
  const coin = parseCoin(findAttr(attrsPairs, 'amount'));
  transfersRows.push({ tx_hash, from_addr: sender, to_addr: recipient, ... });
}
```

## Database Schema Coverage

| Schema | Tables |
|--------|--------|
| `core` | blocks, transactions, messages, events, event_attributes |
| `bank` | transfers, balance_deltas |
| `stake` | delegation_events, distribution_events |
| `gov` | proposals, deposits, votes |
| `wasm` | executions, events, contract_migrations, state_kv |
| `tokens` | cw20_transfers |
| `authz_feegrant` | authz_grants, fee_grants |

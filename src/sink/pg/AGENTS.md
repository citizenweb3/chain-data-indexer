# PostgreSQL Sink Helpers (sink/pg/)

**Purpose:** PostgreSQL-specific insert logic, batch handling, parsing utilities, and domain-specific flushers for the postgres sink.

## Key Files

| File | Description |
|------|-------------|
| `batch.ts` | Batch insert helpers respecting PostgreSQL parameter limits |
| `parsing.ts` | Row extraction and data transformation utilities |
| `flushers/*.ts` | Bulk insert functions for each entity type |
| `inserters/*.ts` | Single-batch insert functions (used by flushers) |

## Structure

```
src/sink/pg/
├── batch.ts            # makeMultiInsert(), execBatchedInsert()
├── parsing.ts          # normArray, pickMessages, parseCoin, findAttr, etc.
├── flushers/           # Batch flush logic (handles chunking)
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
└── inserters/          # Raw INSERT statements (single batch)
    ├── blocks.ts
    ├── txs.ts
    ├── msgs.ts
    ├── events.ts
    ├── attrs.ts
    ├── transfers.ts
    ├── stake_deleg.ts
    ├── stake_distr.ts
    ├── wasm_exec.ts
    └── wasm_events.ts
```

## Batch Handling (`batch.ts`)

### PostgreSQL Parameter Limit
PostgreSQL has a hard limit of **65,535 parameters** per query. Multi-row inserts must respect this:

```typescript
// Calculate max rows per batch
const paramsPerRow = 10;  // e.g., INSERT INTO t (a,b,c,d,e,f,g,h,i,j) VALUES (...)
const maxRowsPerBatch = Math.floor(65535 / paramsPerRow);
```

### Functions
```typescript
// Build multi-row INSERT statement
function makeMultiInsert(
  table: string,
  columns: string[],
  rows: any[],                        // Array of row objects (not value arrays)
  conflictClause: string,             // e.g., "ON CONFLICT DO NOTHING"
  types?: Record<string, string>      // Column type casts, e.g., { value: 'jsonb' }
): { text: string; values: any[] }

// Execute with automatic batching (respects PostgreSQL limits)
async function execBatchedInsert(
  client: PoolClient,
  table: string,
  columns: string[],
  rows: any[],
  conflictClause: string,
  types?: Record<string, string>,
  opts?: { maxRows?: number; maxParams?: number }  // defaults: 5000, 30000
): Promise<void>
```

### Example
```typescript
// Build INSERT for 3 rows (rows are objects, not arrays)
const { text, values } = makeMultiInsert(
  'core.blocks',
  ['height', 'block_hash', 'time'],
  [
    { height: 1000000, block_hash: 'ABC123', time: new Date() },
    { height: 1000001, block_hash: 'DEF456', time: new Date() },
    { height: 1000002, block_hash: 'GHI789', time: new Date() },
  ],
  'ON CONFLICT DO NOTHING'
);
// text: INSERT INTO core.blocks (height,block_hash,time) VALUES ($1,$2,$3), ($4,$5,$6), ($7,$8,$9) ON CONFLICT DO NOTHING
// values: [1000000, 'ABC123', Date, 1000001, 'DEF456', Date, ...]
```

## Parsing Utilities (`parsing.ts`)

### Array Helpers
```typescript
normArray(x: any): any[]  // Ensures array, returns [] for non-array
```

### Transaction Parsing
```typescript
// Extract messages from various tx formats
pickMessages(tx: any): any[]

// Extract logs from various tx formats
pickLogs(tx: any): any[]

// Collect signers from message content
collectSignersFromMessages(msgs: any[]): string[] | null
```

### Fee Building
```typescript
buildFeeFromDecodedFee(fee: any): { amount: Coin[], gas_limit: string, ... }
```

### Attribute Helpers
```typescript
// Convert attributes array to pairs
attrsToPairs(attrs: any[]): Array<{ key: string, value: string }>

// Find attribute by key
findAttr(pairs: Array<{ key: string, value: string }>, key: string): string | undefined
```

### Coin Parsing
```typescript
// Parse "1000000uatom" into structured coin
parseCoin(str: string): { amount: string, denom: string } | null

parseCoin("1000000uatom")  // { amount: "1000000", denom: "uatom" }
parseCoin("invalid")       // null
```

### Number Conversion
```typescript
toNum(x: any): number | null  // Safe number conversion
```

## Flushers (flushers/)

Flushers handle batch inserts with automatic chunking:

```typescript
// Example: flushers/blocks.ts
export async function flushBlocks(client: PoolClient, rows: any[]): Promise<void> {
  if (rows.length === 0) return;
  await execBatchedInsert(
    client,
    'core.blocks',
    ['height', 'block_hash', 'time', 'proposer_address', ...],
    rows,
    'ON CONFLICT (height) DO NOTHING',
    { raw_tx: 'jsonb' }
  );
}
```

### Flusher Pattern
```typescript
// 1. Check for empty array (no-op)
if (rows.length === 0) return;

// 2. Delegate to execBatchedInsert with appropriate inserter
await execBatchedInsert(client, rows, insertFn);
```

### Available Flushers
| Flusher | Target Table | Schema |
|---------|--------------|--------|
| `flushBlocks` | `blocks` | core |
| `flushTxs` | `transactions` | core |
| `flushMsgs` | `messages` | core |
| `flushEvents` | `events` | core |
| `flushAttrs` | `event_attributes` | core |
| `flushTransfers` | `transfers` | bank |
| `flushStakeDeleg` | `delegation_events` | stake |
| `flushStakeDistr` | `distribution_events` | stake |
| `flushWasmExec` | `executions` | wasm |
| `flushWasmEvents` | `events` | wasm |
| `flushGovDeposits` | `deposits` | gov |
| `flushGovVotes` | `votes` | gov |
| `upsertGovProposals` | `proposals` | gov |

## Inserters (inserters/)

Inserters build and execute the actual INSERT statements:

```typescript
// Example: inserters/blocks.ts
export async function insertBlocks(client: PoolClient, rows: any[]): Promise<void> {
  const columns = ['height', 'block_hash', 'time', 'proposer_address', 'tx_count', ...];
  const values = rows.map(r => [r.height, r.block_hash, r.time, ...]);
  const { sql, params } = makeMultiInsert('core.blocks', columns, values);
  await client.query(sql, params);
}
```

### Inserter Pattern
```typescript
// 1. Define column list
const columns = ['col1', 'col2', 'col3'];

// 2. Transform rows to value arrays
const values = rows.map(r => [r.col1, r.col2, r.col3]);

// 3. Build and execute INSERT
const { sql, params } = makeMultiInsert(tableName, columns, values);
await client.query(sql, params);
```

## Governance Helpers (`flushers/gov.ts`)

Special handling for governance data:

```typescript
// Standard inserts for deposits and votes
flushGovDeposits(client, rows)
flushGovVotes(client, rows)

// Upsert for proposals (updates on conflict)
upsertGovProposals(client, rows)
// Uses: ON CONFLICT (proposal_id) DO UPDATE SET ...
```

## Common Patterns

### 1. Full Flush Sequence (in postgres.ts)
```typescript
await flushBlocks(client, bufBlocks);
await flushTxs(client, bufTxs);
await flushMsgs(client, bufMsgs);
await flushEvents(client, bufEvents);
await flushAttrs(client, bufAttrs);
await flushTransfers(client, bufTransfers);
// ... etc
```

### 2. Domain-Specific Extraction
```typescript
// In postgres.ts extractRows()
if (event_type === 'transfer') {
  const sender = findAttr(attrsPairs, 'sender');
  const recipient = findAttr(attrsPairs, 'recipient');
  const coin = parseCoin(findAttr(attrsPairs, 'amount'));
  if (sender && recipient && coin) {
    transfersRows.push({
      tx_hash, msg_index, from_addr: sender, to_addr: recipient,
      denom: coin.denom, amount: coin.amount, height
    });
  }
}
```

### 3. JSONB Column Handling
```typescript
// Values that should be stored as JSONB
{
  value: m,        // Full message object → JSONB
  attributes: attrsPairs,  // Attribute array → JSONB
  raw_tx: tx.decoded,      // Full decoded tx → JSONB
  fee: fee,        // Fee object → JSONB
}
// pg driver handles JSON.stringify automatically
```

## Row Schemas

### Block Row
```typescript
{
  height: number,
  block_hash: string | null,
  time: Date,
  proposer_address: string | null,
  tx_count: number,
  size_bytes: number | null,
  last_commit_hash: string | null,
  data_hash: string | null,
  evidence_count: number,
  app_hash: string | null
}
```

### Transaction Row
```typescript
{
  tx_hash: string,
  height: number,
  tx_index: number,
  code: number,
  gas_wanted: number | null,
  gas_used: number | null,
  fee: object,      // JSONB
  memo: string | null,
  signers: string[] | null,  // JSONB array
  raw_tx: object,   // JSONB
  log_summary: string | null,
  time: Date
}
```

### Message Row
```typescript
{
  tx_hash: string,
  msg_index: number,
  height: number,
  type_url: string,  // e.g., "/cosmos.bank.v1beta1.MsgSend"
  value: object,     // JSONB - full message content
  signer: string | null
}
```

### Event Row
```typescript
{
  tx_hash: string,
  msg_index: number,
  event_index: number,
  event_type: string,
  attributes: Array<{key, value}>,  // JSONB
  height: number
}
```

# Runner Module

**Purpose:** Orchestrates block synchronization — both historical backfilling (`syncRange`) and real-time following (`followLoop`).

## Key Files

| File | Description |
|------|-------------|
| `syncRange.ts` | Range-based backfill with concurrency, retries, ordered flushing |
| `follow.ts` | Infinite polling loop for real-time block indexing |

## Dependencies

- `../rpc/client.js` — RPC client for block fetching
- `../decode/txPool.js` — Transaction decoding pool
- `../sink/index.js` — Output sink for persistence
- `../assemble/blockJson.js` — Block assembly
- `../utils/logger.js` — Winston logging
- `../utils/time.js` — Duration formatting
- `../utils/sleep.js` — Async sleep utility

## Used By

- `src/index.ts` — Calls `syncRange()` then `followLoop()`

## Structure

```
src/runner/
├── syncRange.ts    # Historical backfill
└── follow.ts       # Real-time following
```

## syncRange() — Backfill Mode

### Interface
```typescript
async function syncRange(
  rpc: RpcClient,
  pool: TxDecodePool,
  sink: Sink,
  opts: SyncRangeOptions
): Promise<{ processed: number }>
```

### Options
```typescript
interface SyncRangeOptions {
  from: number;              // Start height (inclusive)
  to: number;                // End height (inclusive)
  concurrency: number;       // Max in-flight heights
  progressEveryBlocks: number;
  progressIntervalSec: number;
  caseMode: 'snake' | 'camel';
  blockTimeoutMs?: number;   // Per-height timeout (default: 30000)
  maxBlockRetries?: number;  // Max retries per height (default: 3)
  reportSpeed?: boolean;     // Include rate/ETA in logs (default: true)
}
```

### Processing Flow
```
syncRange(from=1000, to=2000, concurrency=8)
    │
    ├── Spawn up to 8 concurrent height processors
    │   └── processHeight(h):
    │       ├── rpc.fetchBlock(h)
    │       ├── rpc.fetchBlockResults(h)
    │       ├── pool.submit(tx) for each tx
    │       ├── assembleBlockJsonFromParts()
    │       └── ready.set(h, assembled)
    │
    ├── Ordered flush buffer (ready Map)
    │   └── tryFlush(): writes heights in order starting from nextToFlush
    │
    ├── Retry queue for failed heights
    │   └── retryQueue: heights that failed but have retries left
    │
    └── Progress reporting
        └── "[progress] 500/1000 blocks | rate 25.3 blk/s | ETA 19s"
```

### Key Mechanisms

**Ordered Flushing Buffer**
```typescript
const ready = new Map<number, BlockJson>();
let nextToFlush = from;

// Blocks are processed out-of-order but flushed in-order
while (ready.has(nextToFlush)) {
  await sink.write(ready.get(nextToFlush));
  nextToFlush++;
}
```

**Timeout Wrapper**
```typescript
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T>
// Wraps promises with timeout, throws labeled error if exceeded
```

**Retry Logic**
```typescript
// On failure:
if (attempts < maxBlockRetries) {
  retryQueue.push(height);  // Will be retried
} else {
  ready.set(height, { __skip: true, height: h, error: String(e?.message ?? e) });  // Skip marker
}
```

## followLoop() — Real-time Mode

### Interface
```typescript
async function followLoop(
  rpc: RpcClient,
  decodePool: TxDecodePool,
  sink: Sink,
  opts: FollowOptions
): Promise<void>  // Never returns under normal operation
```

### Options
```typescript
interface FollowOptions {
  startNext: number;   // First height to fetch
  pollMs: number;      // Polling interval
  concurrency: number; // Max concurrent processing
  caseMode: 'snake' | 'camel';
}
```

### Processing Flow
```
followLoop(startNext=2001, pollMs=5000)
    │
    └── Infinite loop:
        ├── rpc.fetchStatus() → get latest_block_height
        │
        ├── If next <= latest:
        │   └── syncRange(from=next, to=latest, ...)
        │       └── Processes all new blocks
        │
        └── Else:
            └── sleep(pollMs * jitter)  // 0.8x - 1.2x
```

**Jitter**
```typescript
// Prevents synchronized polling from multiple instances
const jitter = 0.8 + Math.random() * 0.4;  // 0.8 to 1.2
await sleep(Math.floor(pollMs * jitter));
```

## Common Patterns

### 1. Full Indexing Run
```typescript
// In index.ts
const backfill = await syncRange(rpc, pool, sink, {
  from: startFrom,
  to: endHeight,
  concurrency: cfg.concurrency,
  progressEveryBlocks: 1000,
  progressIntervalSec: 15,
  caseMode: 'snake',
});

if (cfg.follow) {
  await followLoop(rpc, pool, sink, {
    startNext: endHeight + 1,
    pollMs: 5000,
    concurrency: cfg.concurrency,
    caseMode: 'snake',
  });
}
```

### 2. Processing a Single Height
```typescript
async function processHeight(h: number) {
  const [block, blockResults] = await Promise.all([
    withTimeout(rpc.fetchBlock(h), blockTimeoutMs, `fetchBlock@${h}`),
    withTimeout(rpc.fetchBlockResults(h), blockTimeoutMs, `fetchBlockResults@${h}`),
  ]);

  const txsB64 = block?.block?.data?.txs ?? [];
  const decoded = await Promise.all(
    txsB64.map((tx, i) => withTimeout(pool.submit(tx), blockTimeoutMs, `decode#${i}@${h}`))
  );

  return assembleBlockJsonFromParts(rpc, block, blockResults, decoded, caseMode);
}
```

## Progress Reporting

```
[progress] 15000/50000 blocks | currentHeight 15000 | elapsed 5m 32s | rate 45.2 blk/s | ETA 12m 54s | inFlight=8 retryQ=0 next=15008
```

- Reports every N blocks or N seconds
- Shows processing rate and ETA
- Tracks in-flight requests and retry queue size

## Error Handling

- **Per-height timeout**: Each operation has individual timeout
- **Retries**: Failed heights queued for retry (up to maxBlockRetries)
- **Skip markers**: After max retries, height marked as skipped
- **Sink flush**: Called after catching up in follow mode

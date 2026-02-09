# Decode Module

**Purpose:** Parallel transaction decoding using worker threads. Loads protobuf definitions and decodes Cosmos SDK transactions from base64 format.

## Key Files

| File | Description |
|------|-------------|
| `txPool.ts` | Worker pool manager — spawns workers, distributes jobs, collects results |
| `txWorker.ts` | Worker thread — handles init/decode messages, runs in separate thread |
| `txWorker.types.ts` | TypeScript types for worker message protocol |
| `dynamicProto.ts` | Loads `.proto` files dynamically using `protobufjs` |
| `decoders/tx.ts` | Transaction decoding logic using loaded proto root |
| `decoders/context.ts` | Global proto root storage (set/get/clear) |

## Dependencies

- `node:worker_threads` — Node.js worker thread API
- `protobufjs` — Protocol Buffers parser and decoder
- `../utils/logger.js` — Winston-based logging

## Used By

- `src/index.ts` — Creates decode pool from config
- `src/runner/syncRange.ts` — Submits transactions for decoding
- `src/runner/follow.ts` — Uses pool for real-time tx decoding

## Structure

```
src/decode/
├── txPool.ts           # Worker pool factory and manager
├── txWorker.ts         # Worker thread entry point
├── txWorker.types.ts   # Message type definitions
├── dynamicProto.ts     # Proto file loader with progress
└── decoders/
    ├── context.ts      # Proto root singleton (set/get/clear)
    └── tx.ts           # decodeTxBase64() implementation
```

## Worker Pool Interface (`txPool.ts`)

```typescript
type TxDecodePool = {
  submit: (txBase64: string) => Promise<any>;  // Decode a transaction
  close: () => Promise<void>;                   // Terminate all workers
};

const pool = createTxDecodePool(size, { protoDir });
const decoded = await pool.submit(txBase64);
await pool.close();
```

## Worker Message Protocol

### Input Messages (Main → Worker)
```typescript
type InitMsg = { type: 'init'; protoDir?: string };
type DecodeMsg = { type: 'decode'; id: number; txBase64: string };
```

### Output Messages (Worker → Main)
```typescript
type ProgressMsg = { type: 'progress'; loaded: number; total: number };
type ReadyMsg = { type: 'ready'; ok: boolean; detail?: string };
type WorkerOk = { id: number; ok: true; decoded: any };
type WorkerErr = { id: number; ok: false; error: string };
```

## Pool Lifecycle

```
createTxDecodePool(size)
    │
    ├── Spawn N workers (txWorker.ts)
    │   └── Each worker: loads proto files, sends 'ready'
    │
    ├── Wait for all workers ready (with 30s timeout)
    │
    ├── submit(txBase64)
    │   ├── Wait for idle worker
    │   ├── Send 'decode' message
    │   └── Return Promise for result
    │
    └── close()
        └── Terminate all workers
```

## Proto Loading (`dynamicProto.ts`)

```typescript
const root = await loadProtoRootWithProgress(
  protoDir,
  (loaded, total) => console.log(`Loading: ${loaded}/${total}`),
  progressIntervalMs
);
```

- Recursively finds all `.proto` files in directory
- Loads them into a single `protobufjs.Root`
- Reports progress during load (for UI feedback)

## Transaction Decoding (`decoders/tx.ts`)

```typescript
const decoded = decodeTxBase64(txBase64);
// Returns: DecodedTx object with body, auth_info, signatures
```

Decoding flow:
1. Base64 → bytes
2. Bytes → `TxRaw` (protobuf)
3. `TxRaw.body_bytes` → `TxBody`
4. `TxRaw.auth_info_bytes` → `AuthInfo`
5. Recursively decode nested `Any` messages
6. Convert to JSON-serializable object

## Common Patterns

### 1. Creating Pool
```typescript
const poolSize = Math.max(1, Math.min(cfg.concurrency ?? 8, 8));
const decodePool = createTxDecodePool(poolSize, { protoDir });
```

### 2. Parallel Decoding
```typescript
const txsB64: string[] = block.data.txs;
const decoded = await Promise.all(
  txsB64.map((tx) => decodePool.submit(tx))
);
```

### 3. Worker Thread Execution
```typescript
// In txWorker.ts
parentPort.on('message', (msg) => {
  if (msg.type === 'init') return onInit(msg);
  if (msg.type === 'decode') return onDecode(msg);
});
```

## Proto Directory Structure

```
protos/
├── cosmos/
│   ├── tx/v1beta1/tx.proto
│   ├── base/v1beta1/coin.proto
│   ├── crypto/secp256k1/keys.proto
│   └── ...
├── ibc/
├── cosmwasm/
└── ...
```

## Error Handling

- Worker init timeout (30s) → worker marked ready anyway, decode may fail
- Decode error → returns `WorkerErr` with error message
- Worker crash → pending promises rejected, logged
- Pool handles retries at higher level (runner)

## Performance Notes

- Workers are long-lived, reused across many blocks
- Proto loading happens once per worker at init
- Idle workers are tracked for job distribution
- Pool size typically matches CPU cores (capped at 8)

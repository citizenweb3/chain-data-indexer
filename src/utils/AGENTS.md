# Utils Module

**Purpose:** Shared utility functions — logging, case conversion, byte operations, JSON handling, time formatting, and async helpers.

## Key Files

| File | Description |
|------|-------------|
| `logger.ts` | Winston-based logging with child loggers per module |
| `case.ts` | Deep key conversion between snake_case and camelCase |
| `bytes.ts` | Base64/hex encoding, SHA-256 hashing |
| `json.ts` | Safe JSON parsing utilities |
| `time.ts` | Duration formatting for progress logs |
| `sleep.ts` | Async sleep utility |
| `pLimit.ts` | Concurrency limiter for parallel operations |
| `pruneUndefined.ts` | Remove undefined values from objects |
| `stripLarge.ts` | Remove large/redundant fields for memory efficiency |

## Dependencies

- `winston` — Logging framework
- `@cosmjs/encoding` — Base64/hex encoding utilities
- `crypto.subtle` (Web Crypto API) — SHA-256 hashing

## Used By

All modules throughout the codebase.

## Structure

```
src/utils/
├── logger.ts         # Logging (getLogger, initLogger, setLogLevel)
├── case.ts           # deepConvertKeys(), toSnakeKey(), toCamelKey()
├── bytes.ts          # sha256Hex(), base64ToBytes(), bytesToHex()
├── json.ts           # safeJsonParse()
├── time.ts           # formatDuration()
├── sleep.ts          # sleep()
├── pLimit.ts         # createPLimit()
├── pruneUndefined.ts # pruneUndefined()
└── stripLarge.ts     # stripLarge()
```

## Logger (`logger.ts`)

### Core Functions
```typescript
// Initialize root logger (optional, auto-initialized on first use)
initLogger({ level?: string, json?: boolean }): Logger

// Get child logger with module label
getLogger(label: string): Logger

// Change log level at runtime
setLogLevel(level: string): void

// Flush and close transports
flushLogger(): Promise<void>

// Get root logger directly
getRootLogger(): Logger
```

### Log Levels
```
error > warn > info > http > verbose > debug > silly
                                              (trace = silly)
```

### Usage Pattern
```typescript
import { getLogger } from '../utils/logger.js';

const log = getLogger('rpc/client');
log.info('Connected to RPC', { url: rpcUrl });
log.debug('Request details', { path, params });
log.error('Connection failed', { error: err.message });
```

### Output Formats
```
// Development (colored, readable)
2024-01-15T10:30:45.123Z [rpc/client] info: Connected to RPC {"url":"http://..."}

// Production (JSON)
{"timestamp":"2024-01-15T10:30:45.123Z","level":"info","message":"Connected to RPC","label":"rpc/client","url":"http://..."}
```

## Case Conversion (`case.ts`)

### Functions
```typescript
// Convert keys recursively (preserves @type keys)
deepConvertKeys<T>(input: T, mode: 'snake' | 'camel'): T

// Internal helpers
toSnakeKey(k: string): string  // "camelCase" → "camel_case"
toCamelKey(k: string): string  // "snake_case" → "snakeCase"
```

### Special Handling
```typescript
// @type keys preserved exactly (protobuf type URLs)
deepConvertKeys({ '@type': '/cosmos.tx.v1beta1.Tx', fromAddress: 'cosmos1...' }, 'snake')
// → { '@type': '/cosmos.tx.v1beta1.Tx', from_address: 'cosmos1...' }
```

## Byte Operations (`bytes.ts`)

### Functions
```typescript
// Compute SHA-256 hash as uppercase hex string
sha256Hex(data: Uint8Array): Promise<string>

// Convert base64 string to bytes
base64ToBytes(b64: string): Uint8Array

// Convert bytes to hex string
bytesToHex(bytes: Uint8Array): string

// Convert hex string to bytes
hexToBytes(hex: string): Uint8Array

// Convert bytes to base64 string
bytesToBase64(bytes: Uint8Array): string
```

### Usage
```typescript
const rawBytes = base64ToBytes(txBase64);
const txHash = await sha256Hex(rawBytes);  // "A1B2C3D4..."
const hexTx = bytesToHex(rawBytes).toUpperCase();
```

## Time Formatting (`time.ts`)

```typescript
// Format seconds into human-readable duration
formatDuration(seconds: number): string

formatDuration(65)     // "1m 5s"
formatDuration(3665)   // "1h 1m 5s"
formatDuration(0.5)    // "0s"
```

## Sleep Utility (`sleep.ts`)

```typescript
// Async delay
sleep(ms: number): Promise<void>

await sleep(1000);  // Wait 1 second
```

## Concurrency Limiter (`pLimit.ts`)

```typescript
// Create limiter with max concurrent operations
const limit = createPLimit(10);

// Use with async operations
await Promise.all(urls.map(url => limit(() => fetch(url))));
```

## Prune Undefined (`pruneUndefined.ts`)

```typescript
// Remove undefined values from object
pruneUndefined({ a: 1, b: undefined, c: null })
// → { a: 1, c: null }
```

## Strip Large Fields (`stripLarge.ts`)

```typescript
// Remove redundant/large fields to save memory
stripLarge(blockResp)
// Removes: evidence arrays, redundant nested copies, etc.
```

## Common Patterns

### 1. Module-Level Logger
```typescript
// At top of each file
const log = getLogger('module/name');

// Use throughout
log.info('Operation completed', { count: 42 });
log.warn('Unexpected state', { state });
log.error('Failed', { error: e.message });
```

### 2. Case Conversion in Assembly
```typescript
const converted = deepConvertKeys(decodedTx.body.messages, cfg.caseMode);
```

### 3. Transaction Hashing
```typescript
const rawBytes = base64ToBytes(tx.raw.base64);
const hash = await sha256Hex(rawBytes);
```

### 4. Progress Duration Formatting
```typescript
const elapsedSec = (Date.now() - startTime) / 1000;
log.info(`Completed in ${formatDuration(elapsedSec)}`);
// "Completed in 5m 32s"
```

### 5. Safe JSON Operations
```typescript
import { safeJsonParse } from '../utils/json.js';

const parsed = safeJsonParse(rawLog, []);  // Returns [] on parse error
```

## Environment Variables

| Variable | Effect |
|----------|--------|
| `LOG_LEVEL` | Default log verbosity (debug/info/warn/error) |
| `NODE_ENV` | `production` → JSON output, else colored text |

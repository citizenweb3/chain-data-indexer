# RPC Module

**Purpose:** HTTP client for communicating with CometBFT/Tendermint RPC endpoints. Implements rate limiting, retries with exponential backoff, and connection pooling.

## Key Files

| File | Description |
|------|-------------|
| `client.ts` | Main RPC client with `getJson`, `fetchBlock`, `fetchBlockResults`, `fetchStatus` |
| `ratelimit.ts` | Token bucket rate limiter implementation |

## Dependencies

- `undici` — High-performance HTTP client with connection pooling
- `../utils/logger.js` — Winston-based logging

## Used By

- `src/index.ts` — Creates RPC client from config
- `src/runner/syncRange.ts` — Fetches blocks and block results
- `src/runner/follow.ts` — Polls for new blocks
- `src/assemble/blockJson.ts` — Receives RPC responses for assembly

## Structure

```
src/rpc/
├── client.ts       # RpcClient factory and implementation
└── ratelimit.ts    # TokenBucket for RPS throttling
```

## RPC Client Interface (`client.ts`)

```typescript
type RpcClient = {
  getJson: <T>(path: string, params?: Record<string, string | number | boolean | undefined>) => Promise<T>;
  fetchBlock: (height: number) => Promise<any>;
  fetchBlockResults: (height: number) => Promise<any>;
  fetchStatus: () => Promise<any>;
};
```

## Client Options

```typescript
type RpcClientOptions = {
  baseUrl: string;       // http(s)://host:26657
  timeoutMs: number;     // Per-request timeout (required, defaults set in config layer)
  retries: number;       // Max retries for transient errors (required)
  backoffMs: number;     // Base backoff delay (required)
  backoffJitter: number; // Jitter factor 0..1 (required)
  rps: number;           // Target requests/second (required)
  headers?: Record<string, string>;
};
```

**Note**: All options except `headers` are required. Default values come from the config layer:
- `timeoutMs`: 5000 (from `TIMEOUT_MS`)
- `retries`: 3 (from `RETRIES`)
- `backoffMs`: 250 (from `BACKOFF_MS`)
- `backoffJitter`: 0.3 (from `BACKOFF_JITTER`)
- `rps`: 150 (from `RPS`)
```

## Connection Pool Configuration

```typescript
const agent = new Agent({
  connections: 128,           // Max concurrent connections
  keepAliveTimeout: 10_000,   // 10 seconds
  keepAliveMaxTimeout: 60_000 // 60 seconds
});
```

## Rate Limiting (`ratelimit.ts`)

Token bucket algorithm for controlling request rate:

```typescript
const bucket = createTokenBucket(rps, burstMultiplier);
await bucket.take(1);  // Blocks until token available
```

- Refills tokens at `rps` rate
- Allows burst up to `rps * burstMultiplier`
- `take(n)` is async — waits until tokens are available

## Retry Logic

Retries on transient failures with exponential backoff:

```typescript
// Retryable conditions:
// - HTTP 5xx errors
// - HTTP 429 (rate limited)
// - AbortError (timeout)
// - ECONNRESET
// - ETIMEDOUT

const delay = jitter(backoffMs * Math.pow(2, attempt), backoffJitter);
await sleep(delay);
```

## Common Patterns

### 1. Creating Client from Config
```typescript
import { createRpcClientFromConfig } from './rpc/client.ts';

const rpc = createRpcClientFromConfig({
  rpcUrl: cfg.rpcUrl,
  timeoutMs: cfg.timeoutMs,
  retries: cfg.retries,
  backoffMs: cfg.backoffMs,
  backoffJitter: cfg.backoffJitter,
  rps: cfg.rps,
});
```

### 2. Fetching Block Data
```typescript
const [block, blockResults] = await Promise.all([
  rpc.fetchBlock(height),
  rpc.fetchBlockResults(height),
]);
```

### 3. Custom RPC Calls
```typescript
const validators = await rpc.getJson('/validators', { height, per_page: 100 });
```

## RPC Endpoints Used

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/status` | `fetchStatus()` | Node sync info, latest/earliest heights |
| `/block` | `fetchBlock(h)` | Block header, txs, last_commit |
| `/block_results` | `fetchBlockResults(h)` | Tx results, events, validator updates |

## Error Handling

- Transient errors → retry with backoff
- Permanent errors (4xx except 429) → throw immediately
- Timeout → treated as transient, retried
- All errors logged with context (attempt, delay, status)

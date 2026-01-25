# Source Code Overview (src/)

**Purpose:** Main source directory for the Chain Data Indexer — a high-performance blockchain data indexer for the Cosmos ecosystem.

## Data Flow Pipeline

```
RPC Client → Block Fetching → Tx Decoding Pool → Assembly → Normalize → Sink → Storage
 (rpc/)        (runner/)         (decode/)       (assemble/)  (normalize/)  (sink/)   (db/)
```

## Module Overview

| Module | Location | Purpose |
|--------|----------|---------|
| Entry Point | `index.ts` | Main orchestrator; initializes services, controls sync flow |
| Config | `config/` | Environment-based config with Zod validation |
| RPC Client | `rpc/` | Undici HTTP client with token-bucket rate limiting, retries |
| Tx Decoder | `decode/` | Worker thread pool for parallel protobuf decoding |
| Assembly | `assemble/` | Combines RPC responses + decoded txs into `BlockJson` |
| Normalize | `normalize/` | Event normalization (base64→UTF8) and governance data parsing |
| Runner | `runner/` | `syncRange` (backfill) and `follow` (real-time polling) modes |
| Sink | `sink/` | Output backends: stdout, file, postgres, clickhouse, null |
| Database | `db/` | PostgreSQL pooling, partitioning, progress tracking |
| Utils | `utils/` | Logger, case conversion, bytes, JSON, sleep, time formatting |

## Key Files

| File | Description |
|------|-------------|
| `index.ts` | Application entry point, orchestrates all modules |
| `config.ts` | Config builder, aggregates env vars and CLI args |
| `types.d.ts` | Core TypeScript types: `Config`, `BlockJson`, `DecodedTx`, `AbciEvent` |

## Entry Point Flow (`index.ts`)

```typescript
main()
  ├── getConfig()           // Load and validate configuration
  ├── createRpcClient()     // Initialize HTTP client with rate limiting
  ├── rpc.fetchStatus()     // Get chain status for height resolution
  ├── getProgress()         // Resume from last DB height (if postgres sink)
  ├── createTxDecodePool()  // Spawn N worker threads for tx decoding
  ├── createSink()          // Initialize output backend
  ├── syncRange()           // Backfill historical blocks
  └── followLoop()          // Real-time polling (if --follow enabled)
```

## Key Types (`types.d.ts`)

### Config
Full application configuration resolved from CLI args, env vars, and defaults.

### BlockJson
Normalized block structure with transactions and events:
```typescript
{
  meta: { chain_id, height, time },
  block: { block_id, header, data, last_commit },
  block_results: { begin_block_events, end_block_events, txs_results },
  txs: [{ index, hash, raw, decoded, tx_response }]
}
```

### DecodedTx
Decoded Cosmos SDK transaction:
```typescript
{
  '@type': '/cosmos.tx.v1beta1.Tx',
  body: { messages, memo, timeout_height, extension_options },
  auth_info: { signer_infos, fee, tip },
  signatures: string[]
}
```

### AbciEvent
ABCI event from block execution:
```typescript
{ type: string, attributes: [{ key, value, index }] }
```

## Configuration Priority

1. CLI arguments (`--rpc-url`, `--from`, etc.)
2. Environment variables (`RPC_URL`, `FROM`, etc.)
3. `.env` file
4. Default values

## Signal Handling

- `SIGINT` / `SIGTERM`: Graceful shutdown, flushes pending data

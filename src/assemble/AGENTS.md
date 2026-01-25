# Assemble Module

**Purpose:** Combines raw RPC responses (block and block_results) with decoded transactions into a normalized `BlockJson` structure suitable for storage and downstream processing.

## Key Files

| File | Description |
|------|-------------|
| `blockJson.ts` | Main assembly logic: `assembleBlockJsonFromParts()`, `assembleTxObjects()` |

## Dependencies

- `../types.js` — `BlockJson`, `TxsResult`, `AbciEvent` types
- `../rpc/client.js` — `RpcClient` type
- `../normalize/events/index.js` — Event normalization functions
- `../utils/bytes.js` — Hash computation, base64/hex conversion
- `../utils/case.js` — Key case conversion (snake/camel)
- `../utils/stripLarge.js` — Large field removal for memory efficiency

## Used By

- `src/runner/syncRange.ts` — Assembles blocks during backfill
- `src/runner/follow.ts` — Assembles blocks in real-time mode

## Structure

```
src/assemble/
└── blockJson.ts    # All assembly logic
```

## Main Functions

### `assembleBlockJsonFromParts()`
```typescript
async function assembleBlockJsonFromParts(
  rpc: RpcClient,
  blockResp: any,           // Raw /block response
  blockResultsResp: any,    // Raw /block_results response
  decodedTxs: any[],        // Decoded transactions (parallel array)
  caseMode: CaseMode = 'snake'
): Promise<BlockJson>
```

### `assembleTxObjects()`
```typescript
async function assembleTxObjects(
  heightISOTime: string,    // Block timestamp
  txsB64: string[],         // Base64 encoded transactions
  decoded: any[],           // Decoded transactions
  br: any,                  // Block results
  caseMode: CaseMode = 'snake'
): Promise<BlockJson['txs']>
```

## BlockJson Output Structure

```typescript
{
  meta: {
    chain_id: string,       // e.g., "cosmoshub-4"
    height: string,         // Block height as string
    time: string            // ISO-8601 timestamp
  },
  block: {
    block_id: { ... },
    header: { ... },
    data: {
      txs_base64: string[],
      txs_hex?: string[]
    },
    last_commit: { ... }
  },
  block_results: {
    begin_block_events: AbciEvent[],
    end_block_events: AbciEvent[],
    txs_results: TxsResult[],
    validator_updates?: any[],
    consensus_param_updates?: any
  },
  txs: [{
    index: number,
    hash: string,           // SHA-256 of raw tx bytes (uppercase hex)
    raw: {
      base64: string,
      hex: string
    },
    decoded: DecodedTx,
    tx_response: {
      height: string,
      codespace: string,
      code: number,
      data: string,
      raw_log: string,
      logs?: [{ msg_index, events }],
      events?: AbciEvent[],
      gas_wanted: string,
      gas_used: string,
      timestamp: string
    }
  }]
}
```

## Assembly Flow

```
Input:
  ├── blockResp (from rpc.fetchBlock)
  ├── blockResultsResp (from rpc.fetchBlockResults)
  └── decodedTxs (from decode pool)

Processing:
  ├── getMeta(blockResp)           → Extract chain_id, height, time
  ├── getTxsBase64(blockResp)      → Extract base64 tx strings
  ├── getTxsResults(br, count)     → Align txs_results array
  │
  └── assembleTxObjects()
      ├── For each tx:
      │   ├── sha256Hex(rawBytes)   → Compute tx hash
      │   ├── deepConvertKeys()     → Apply case mode to messages
      │   ├── normalizeEvents()     → Decode base64 event attrs
      │   └── buildCombinedLogs()   → Merge logs with events
      │
      └── Return tx objects array

Output:
  └── BlockJson with meta, block, block_results, txs
```

## Common Patterns

### 1. Full Block Assembly
```typescript
const blockJson = await assembleBlockJsonFromParts(
  rpc,
  blockResp,
  blockResultsResp,
  decodedTxs,
  'snake'  // or 'camel'
);
```

### 2. Case Mode Handling
```typescript
// Preserves @type while converting other keys
const msgs = decodedTx.body.messages.map((m) => {
  const { ['@type']: atype, ...rest } = m;
  const converted = deepConvertKeys(rest, caseMode);
  return atype !== undefined ? { ['@type']: atype, ...converted } : converted;
});
```

### 3. Large Field Stripping
```typescript
// stripLarge removes verbose/redundant fields for memory efficiency
block: stripLarge(blockResp),
block_results: stripLarge(blockResultsResp),
```

## Helper Functions

### `getMeta(b)`
Extracts block metadata from header.

### `getTxsBase64(b)`
Extracts transaction byte strings, filters non-strings.

### `getTxsResults(br, count)`
Aligns `txs_results` array with transaction count, fills missing with defaults.

## Edge Cases Handled

- Missing txs_results → filled with `{ code: 0, events: [] }`
- Non-string tx entries → filtered out
- Missing decoded tx → uses empty skeleton
- Length mismatch between txs and results → logged, filled with defaults

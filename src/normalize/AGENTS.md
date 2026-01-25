# Normalize Module

**Purpose:** Normalize blockchain event data — decode base64-encoded ABCI event attributes to UTF-8, parse raw logs, and extract governance-related data.

## Key Files

| File | Description |
|------|-------------|
| `events/index.ts` | Re-exports all event normalization functions |
| `events/base64.ts` | Base64 detection and decoding helpers |
| `events/normalize.ts` | Event and attribute normalization functions |
| `events/parse.ts` | Log parsing and combined log building |
| `gov.ts` | Governance data extraction (proposals, votes, deposits) |

## Dependencies

- `../types.js` — `AbciEvent`, `AbciEventAttr` types

## Used By

- `src/assemble/blockJson.ts` — Normalizes events during assembly
- `src/sink/postgres.ts` — May use governance parsing

## Structure

```
src/normalize/
├── events/
│   ├── index.ts        # Re-exports
│   ├── base64.ts       # tryB64ToUtf8(), isLikelyBase64()
│   ├── normalize.ts    # normalizeEvent(), normalizeEvents(), normalizeAttr()
│   └── parse.ts        # parseRawLog(), buildCombinedLogs()
└── gov.ts              # Governance data extraction
```

## Event Normalization Functions

### `normalizeAttr(a)` → `AbciEventAttr`
```typescript
// Input: raw attribute from ABCI
{ key: "cmVjaXBpZW50", value: "Y29zbW9zMS4uLg==", index: true }

// Output: normalized with base64 decoded
{ key: "recipient", value: "cosmos1...", index: true }
```

### `normalizeEvent(e)` → `AbciEvent`
```typescript
// Normalizes event type and all attributes
{ type: "transfer", attributes: [...] }
```

### `normalizeEvents(evs)` → `AbciEvent[]`
```typescript
// Normalizes array of events, returns empty array for invalid input
const events = normalizeEvents(txResult.events);
```

## Base64 Handling (`base64.ts`)

### `tryB64ToUtf8(s)`
```typescript
// Attempts base64 decode, returns original if not valid base64/UTF-8
tryB64ToUtf8("aGVsbG8=")  // → "hello"
tryB64ToUtf8("not-base64") // → "not-base64"
```

### `looksLikeBase64(s)` / `isCanonicalBase64(s)`
```typescript
// Heuristic check: length divisible by 4, valid charset, padding
looksLikeBase64("aGVsbG8=")    // → true (quick check)
isCanonicalBase64("aGVsbG8=")  // → true (strict validation)
looksLikeBase64("hello")       // → false
```

## Log Parsing (`parse.ts`)

### `parseRawLog(raw)`
```typescript
// Parses raw_log JSON string into structured logs
// Input: '[{"msg_index":0,"events":[...]}]'
// Output: [{ msg_index: 0, events: [...] }]
```

### `buildCombinedLogs(rawLog, txEvents)`
```typescript
// Combines parsed logs with tx-level events
// Used when raw_log is empty but tx events exist
const logs = buildCombinedLogs(tx.raw_log, tx.events);
```

## Common Patterns

### 1. Normalizing Transaction Events
```typescript
import { normalizeEvents, buildCombinedLogs } from '../normalize/events/index.js';

const txLevelEvents = normalizeEvents(result.events ?? []);
const logs = buildCombinedLogs(result.log ?? '', txLevelEvents);
```

### 2. Accessing Normalized Attributes
```typescript
for (const event of normalizeEvents(events)) {
  for (const attr of event.attributes) {
    console.log(`${attr.key} = ${attr.value}`);
    // Keys and values are already decoded from base64
  }
}
```

### 3. Event Filtering by Type
```typescript
const transfers = normalizeEvents(events).filter(e => e.type === 'transfer');
const delegates = normalizeEvents(events).filter(e => e.type === 'delegate');
```

## Governance Parsing (`gov.ts`)

Extracts governance-related data from block events:

- **Proposals**: proposal_id, status, voting_start, voting_end
- **Votes**: proposal_id, voter, option, weight
- **Deposits**: proposal_id, depositor, amount

## Why Normalize?

1. **Base64 Encoding**: CometBFT encodes event attributes as base64 for wire efficiency
2. **Consistency**: Different nodes may return events in different formats
3. **Downstream Processing**: Sinks expect human-readable strings, not base64
4. **Validation**: Ensures all attributes have key/value/index fields

## Edge Cases Handled

- Invalid base64 → returns original string
- Non-UTF8 decoded bytes → returns original string
- Missing attributes array → returns empty array
- Invalid log JSON → returns empty logs
- Mixed encoded/plain attributes → each handled individually

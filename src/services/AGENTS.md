# Services

Service layer between SQL queries (`src/queries/`) and HTTP route handlers (`src/app/api/v1/`).

## Responsibilities

- Compose query results (e.g. join `tx + messages + events` for `getTxDetail`).
- **Convert `BigInt` → decimal `string`** at the JSON boundary. `JSON.stringify(BigInt)` throws `TypeError` — must convert before returning.
- Convert `Date` → ISO string.
- Apply `limit+1` paging logic: probe extra row, slice to `limit`, emit `has_more` + cursor.
- Cache where appropriate (in-memory TTL + inflight dedup).

## Files

| File | Functions |
|---|---|
| `address-service.ts` | `getCoverage`, `getEarliestActivity` |
| `blocks-service.ts` | `listBlocks`, `getBlocksStats`, `getBlockByHeight` |
| `staking-delta-service.ts` | `listStakingDeltas` |
| `txs-service.ts` | `listTxs`, `getTxsStats`, `getTxDetail`, `getTxRaw` |

## Caching

`getTxsStats` uses module-level cache:
- TTL 60s (`COUNT(*)` over partitioned `core.transactions` is expensive).
- Inflight dedup via shared promise — N concurrent requests → 1 SQL.
- Reset on process restart (no Redis yet).

`getBlocksStats` uses `MAX(height)` (PK index reverse scan, ~O(1)) — no cache needed.

## Output conventions

```ts
// every uint64-style field becomes a string:
height: row.height.toString()
gas_wanted: row.gas_wanted !== null ? row.gas_wanted.toString() : null

// dates → ISO:
time: row.time.toISOString()

// keyset cursor only when has_more:
const cursor = hasMore && last ? { next_before_height: last.height.toString() } : null;
```

## Don't do

- Don't put SQL here — it lives in `src/queries/`.
- Don't read env or headers — that's the route handler's job.
- Don't `JSON.stringify` BigInt; convert via `.toString()`.
- Don't return Postgres `Date` directly — always ISO-format.

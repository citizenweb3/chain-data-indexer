# Queries

SQL access via `postgres` v3 tagged templates. Single connection pool from `src/db/indexer-db.ts`.

## Connection

- `DATABASE_URL` from env.
- `types.bigint = postgres.BigInt` — uint64 columns return native `BigInt`, not `string` or unsafe `Number`.
- `idle_timeout: 60`, `max_lifetime: 1800`, `connect_timeout: 10`, `prepare: true`, `max: 10`.

## Files

| File | Exports |
|---|---|
| `blocks-queries.ts` | `queryBlocksList`, `queryBlocksTotal`, `queryBlocksStats`, `queryBlockByHeight` |
| `txs-queries.ts` | `queryTxsList`, `queryTxsTotal`, `queryTxsStats`, `queryTxByHash`, `queryTxMessages`, `queryTxEvents`, `queryTxRaw` |

## Pagination pattern

`fetch = limit + 1`. Service slices off the probe row to compute `has_more`.

```ts
WHERE height < ${beforeHeight}
ORDER BY height DESC
LIMIT ${fetch}
```

For txs (composite key):
```ts
WHERE (height, tx_index) < (${beforeHeight}, ${beforeIndex})
ORDER BY height DESC, tx_index DESC
```

## Schema gotchas

- `core.events` is partitioned `HASH(tx_hash)` — **has no `height` column**. Filter by `tx_hash` only.
- `core.blocks/transactions/messages` are partitioned `RANGE(height)` — always include `height` in WHERE if known (partition pruning).
- `pg_class.reltuples` on a partitioned parent is always 0. Sum across child partitions:
  ```sql
  SELECT COALESCE(SUM(c.reltuples), 0)::bigint
  FROM pg_class c
  JOIN pg_inherits i ON i.inhrelid = c.oid
  WHERE i.inhparent = 'core.transactions'::regclass
  ```

## Counting strategies

| Need | Strategy |
|---|---|
| Latest block height | `MAX(height)` from `core.blocks` (PK reverse scan, ~O(1)) |
| Total tx count | `COUNT(*)` on `core.transactions` — expensive, cache 60s in service |
| Approx total | `SUM(reltuples)` across partitions — O(1), ±1-5% accuracy |

## Don't do

- Don't string-interpolate values — use tagged template params (`${val}`) for SQL injection safety.
- Don't return values to routes directly — services handle BigInt → string conversion.
- Don't open new `postgres()` connections; reuse `db` singleton.

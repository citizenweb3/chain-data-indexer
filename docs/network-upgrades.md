# Network Upgrade Playbook

Use this guide when Logos publishes a new testnet or mainnet release that may
change block structure, RPC behavior, or available explorer data.

---

## Required research before code changes

1. Read upstream release notes:
   <https://github.com/logos-blockchain/logos-blockchain/releases>
2. Re-check node API behavior against a live node:
   ```bash
   curl http://localhost:8080/cryptarchia/info
   curl "http://localhost:8080/cryptarchia/blocks?slot_from=0&slot_to=10"
   timeout 30 curl -sN http://localhost:8080/cryptarchia/lib-stream
   ```
3. Compare observed JSON with:
   - `docs/api.md`
   - `src/types.d.ts`
   - `initdb/001-schema.sql`
   - `src/sink/postgres.ts`
4. Do not invent fields. If an upstream field is undocumented, capture a live
   sample and document it before indexing it.

---

## Upgrade checklist

### 1. API and type updates

- Update `docs/api.md` with confirmed endpoint and response changes.
- Update `src/types.d.ts` with explicit types; do not use `any`.
- Update `src/rpc/client.ts` only after confirming endpoint semantics.
- Re-test changed RPC paths against `localhost:8080`.

### 2. Schema changes

For testnet resets with a new genesis:

1. Stop the indexer.
2. Update `initdb/001-schema.sql` if a fresh database is expected.
3. Recreate or truncate local data.
4. Reset progress to slot `0`.
5. Re-run from genesis.

For live networks where data must be preserved:

1. Create a new migration file such as `initdb/002-v0.2-transactions.sql`.
2. Make migration idempotent with `IF NOT EXISTS` where possible.
3. Apply manually:
   ```bash
   psql "$DATABASE_URL" -f initdb/002-v0.2-transactions.sql
   ```
4. Keep `001-schema.sql` as the fresh-install baseline only after deciding how
   fresh installs should look for that release.

### 3. Transaction indexing

`docs/future.md` documents the planned transaction and note tables. When
`block.transactions[]` becomes non-empty:

1. Confirm actual transaction object shape from a live node.
2. Add concrete `MantleTx`, `MantleTxInput`, and `MantleTxOutput` types.
3. Activate or migrate `logos_transactions` and `logos_notes`.
4. Extend `processBlock()` and `processBatch()` transactionally. Block, leader,
   transaction, and note writes must commit or roll back together.
5. Extend `docs/indexer-api.md` with transaction endpoints before exposing them.

### 4. Balance support

Do not add arbitrary wallet balance polling unless Logos exposes a public
aggregate/balance API. In v0.1.2, `/wallet/:public_key/balance` only works for
keys registered in the local node wallet and is not suitable for explorer-wide
balances.

### 5. Finality and forks

- Keep explorer public views defaulting to finalized data.
- If future releases expose canonical fork status, add a separate chain-status
  column instead of overloading `finalized`.
- If non-finalized views become product-critical, implement orphan/fork marking
  and document the semantics in `docs/indexer-api.md`.

---

## Validation after an upgrade

Run:

```bash
npm run build
docker build -t logos-indexer:upgrade-check .
curl http://localhost:8080/cryptarchia/info
curl http://localhost:3001/health
curl http://localhost:3001/api/v1/stats
```

If schema or sink code changed, verify:

- `initdb/001-schema.sql` matches `src/sink/postgres.ts`.
- `ON CONFLICT DO NOTHING` is preserved for block inserts.
- Leader/stat updates are only applied for newly inserted blocks.
- Progress updates happen after each successful batch.

---

## Documentation updates required for each release

For every network release that affects the indexer, update:

| File | What to update |
|---|---|
| `README.md` | Supported version, quick-start caveats, feature status. |
| `docs/api.md` | Logos node API endpoint availability and response samples. |
| `docs/indexer-api.md` | Explorer API endpoints/fields if exposed data changes. |
| `docs/future.md` | Move completed future work into active docs. |
| `docs/operations.md` | New env vars, deployment caveats, troubleshooting. |
| `AGENTS.md` | Current status and constraints for future agents. |

Do not mark features complete until code, schema, docs, and validation are all
updated.

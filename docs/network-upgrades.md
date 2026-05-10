# Monero Network Upgrade Playbook

Use this guide when upgrading the branch to a new monerod release.

---

## Required research before code changes

1. Read Monero release notes end-to-end.
2. Re-check live RPC behavior against a real node.
3. Diff observed payloads against:
   - `docs/api.md`
   - `src/types.d.ts`
   - `initdb/*.sql`
   - `src/rpc/client.ts`
   - `src/sink/postgres.ts`
4. Do not trust docs over live behavior.

---

## Upgrade checklist

### 1. RPC and type review

- Confirm response shape for every RPC this branch uses.
- Update `src/types.d.ts` first, then `src/rpc/client.ts`.
- If new monetary fields appear, keep big-int-safe parsing.
- If a better bulk block-fetch path appears, document it in `docs/api.md` before switching ingestion.

### 2. Schema changes

- Never edit an old applied migration in place.
- Add `initdb/00N-*.sql` files for additive changes.
- Keep fresh installs reproducible from the full migration chain.

### 3. Canonical / reorg behavior

- Re-confirm how alternate chains are reported.
- Keep `is_canonical` independent from `is_settled`.
- Do not collapse reorg handling into height-only logic.

### 4. Supply behavior

- Re-test `get_coinbase_tx_sum` on the new daemon.
- Re-confirm that `emission_amount` is the correct supply value.
- Validate checkpoint hash anchoring still matches `get_block_header_by_height`.

### 5. Validation

Run:

```bash
yarn build
docker build -t monero-indexer:upgrade-check .
```

Then verify against a real node:

```bash
curl http://localhost:3001/health
curl http://localhost:3001/api/v1/stats
curl http://localhost:3001/api/v1/supply
```

---

## Documentation updates required

For any release that changes indexer behavior, update:

| File | What to update |
|---|---|
| `README.md` | supported monerod version, feature notes |
| `docs/api.md` | RPC behavior and samples |
| `docs/indexer-api.md` | public explorer contract |
| `docs/operations.md` | new env vars or operational caveats |
| `docs/future.md` | move delivered future work out of backlog |
| `AGENTS.md` | current constraints for contributors |

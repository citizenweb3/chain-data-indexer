# Agent Roles — Logos Indexer

This file describes the recommended sub-agent workflow for working on this project.
Any agent picking up work here should follow the **research → execute → review** pattern.

---

## Roles

### `research`
- Read `docs/api.md` before touching any RPC or network code.
- Verify upstream Logos release notes at https://github.com/logos-blockchain/logos-blockchain/releases
  before changing anything that depends on block structure or API behaviour.
- Do NOT invent API fields, endpoints, or block schemas. If unsure, check the node directly:
  ```
  curl http://localhost:8080/cryptarchia/info
  curl "http://localhost:8080/cryptarchia/blocks?slot_from=X&slot_to=Y"
  ```
- Check `docs/future.md` before implementing anything related to transactions or balances —
  those features are deliberately deferred.

### `executor`
- Make one logical change at a time. Run `npm run build` or `tsx src/index.ts` to verify.
- Always use explicit types from `src/types.d.ts`; do not use `any`.
- Keep server paths explicit: node binary at `/pool0/logos`, indexer at `/pool0/logos-indexer`.
- Log every significant action at `info` level; use `debug` for per-block noise.
- Never commit `.env` files or any secrets.

### `review`
- After any change to `src/sink/postgres.ts`, verify SQL matches `initdb/001-schema.sql`.
- After any change to `src/rpc/client.ts`, test against the live node at `localhost:8080`.
- Confirm `ON CONFLICT DO NOTHING` / `DO UPDATE` semantics are correct for each upsert.
- Check that `processBlock()` handles `block.header.id === undefined`
  (blocks from `/storage/block` lack an `id` field).

---

## Key constraints (do not violate)

| Constraint | Reason |
|---|---|
| No `any` types | TypeScript strict mode — use types from `types.d.ts` |
| No wallet balance polling | Privacy limitation — see `docs/future.md` |
| No inventing API fields | Logos API is underdocumented; stick to what `docs/api.md` confirms |
| `ON CONFLICT DO NOTHING` on block insert | Re-runs from same slot must be idempotent |
| Progress table always updated after each batch | Enables safe restart without re-indexing |

---

## Quick-start for a new agent

```bash
cd /pool0/logos-indexer
cat docs/api.md          # understand the node API
cat src/types.d.ts       # understand data shapes
cat initdb/001-schema.sql  # understand the DB schema
cat src/sink/postgres.ts   # understand write path
npm install
cp .env.example .env     # fill in PG_PASSWORD
psql $DATABASE_URL -f initdb/001-schema.sql
npm run dev
```

## Current status (v0.1.2)

- [x] Block indexing (slot, height, leader_key, raw JSON)
- [x] Leader/validator statistics
- [x] Backfill with resume
- [x] Live SSE follow
- [ ] Transactions — deferred to v0.2 (see `docs/future.md`)
- [ ] Wallet balances — blocked by privacy design (see `docs/future.md`)

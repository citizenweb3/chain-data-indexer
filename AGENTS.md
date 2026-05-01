# Agent Roles — Logos Indexer

This file describes the recommended sub-agent workflow for working on this project.
Any agent picking up work here should follow the **research → execute → review** pattern.

---

## Roles

### `research`
- Read `docs/api.md` before touching any RPC or network code.
- Read `docs/indexer-api.md` before touching the explorer API.
- Read `docs/operations.md` before changing deployment, env, Docker, or health checks.
- Read `docs/network-upgrades.md` before adapting the indexer to a new Logos release.
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
- Keep public indexer HTTP listeners explicit: `API_BIND=0.0.0.0` and
  Compose `API_HOST_BIND=0.0.0.0`; access control lives at nginx/API-token/UFW.
- Keep PostgreSQL local/private by default; enable `PG_SSL=true` for remote PG.
- Keep Prometheus metrics in `src/metrics/*` on the isolated registry; do not use the global `prom-client` registry.
- For new metric labels, use only bounded fleet-approved names: `module`, `level`, `endpoint`, `group`, `table`, `phase`, `status`.

### `review`
- After any change to `src/sink/postgres.ts`, verify SQL matches `initdb/001-schema.sql`.
- After any change to `src/rpc/client.ts`, test against the live node at `localhost:8080`.
- Confirm `ON CONFLICT DO NOTHING` / `DO UPDATE` semantics are correct for each upsert.
- Check that `processBlock()` handles `block.header.id === undefined`
  (blocks from `/storage/block` lack an `id` field).
- Crash safety: `processBlock()` wraps block + leader writes in one transaction.
  If the process crashes mid-block, the transaction rolls back and restart
  re-indexes the same slot range idempotently.
- Live processing errors should close/reconnect SSE instead of silently
  continuing; gap-fill on reconnect recovers missed slots.
- Public explorer views should default to finalized blocks unless a caller
  explicitly requests `finalized=all`.

---

## Key constraints (do not violate)

| Constraint | Reason |
|---|---|
| No `any` types | TypeScript strict mode — use types from `types.d.ts` |
| No wallet balance polling | Privacy limitation — see `docs/future.md` |
| No inventing API fields | Logos API is underdocumented; stick to what `docs/api.md` confirms |
| `ON CONFLICT DO NOTHING` on block insert | Re-runs from same slot must be idempotent |
| `processBlock` wraps block+leader in one transaction | Prevents partial state on crash |
| `processBatch` for backfill | Single transaction per batch; bulk unnest INSERT |
| `setLastSlot` uses `GREATEST` | Progress never goes backwards (safe for concurrent updates) |
| Progress table always updated after each batch | Enables safe restart without re-indexing |
| `lib-stream` is NDJSON not SSE | Use `http.request` + readline, not EventSource |
| Metrics use `logos_` / `logos_node_` prefixes | Fleet observability contract; keep labels bounded |
| `LOG_FORMAT=json` for production log shipping | Emits `{ts, level, label, message, metadata}` JSON lines |

---

## Quick-start for a new agent

```bash
cd /pool0/logos-indexer
cat docs/api.md          # understand the node API
cat src/types.d.ts       # understand data shapes
cat initdb/001-schema.sql  # understand the DB schema
cat src/sink/postgres.ts   # understand write path (processBlock / processBatch)
cat src/runner/follow.ts   # understand gap-fill + serial SSE queue
cat docs/indexer-api.md    # understand explorer API contract
cat docs/operations.md     # understand env, Docker, troubleshooting
cat docs/network-upgrades.md # understand future release workflow
npm install
cp .env.example .env     # fill in PG_PASSWORD
psql $DATABASE_URL -f initdb/001-schema.sql
npm run dev
```

Health check: `curl http://localhost:3001/health`
Metrics: `curl http://localhost:3001/metrics`
Explorer API: `curl http://localhost:3001/api/v1/stats`

## Current status (v0.1.2)

- [x] Block indexing (slot, height, leader_key, raw JSON)
- [x] Leader/validator statistics
- [x] Backfill with resume
- [x] Live SSE follow
- [x] Gap-free operation: gap-fill on every connect/reconnect
- [x] Serial SSE event queue (no out-of-order progress)
- [x] Atomic block + leader transactions (idempotent on restart)
- [x] Bulk INSERT for backfill (`processBatch` with unnest)
- [x] Retry with exponential backoff on all RPC calls
- [x] Exponential backoff on SSE reconnect (5s → 60s)
- [x] SSE stall detection via fetchInfo heartbeat
- [x] Finality tracking via `/cryptarchia/lib-stream` (NDJSON)
- [x] Health endpoint `GET /health` (lag, node_mode, uptime)
- [x] Prometheus endpoint `GET /metrics` and JSON log format (`LOG_FORMAT=json`)
- [x] Explorer API: `/api/v1/stats`, `/api/v1/blocks`, `/api/v1/validators`
- [x] API, operations, and network-upgrade documentation
- [ ] Transactions — deferred to v0.2 (see `docs/future.md`)
- [ ] Wallet balances — blocked by privacy design (see `docs/future.md`)

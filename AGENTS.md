# Agent Roles — Monero Indexer

This branch follows a strict **research → execute → review** workflow.

---

## Roles

### `research`

- Read `docs/api.md` before changing RPC or sync logic.
- Read `docs/indexer-api.md` before changing public explorer responses.
- Read `docs/operations.md` before touching env vars, Docker, health, or metrics.
- Read `docs/network-upgrades.md` before adapting the branch to a new monerod release.
- Validate behavior against a live Monero node before trusting docs:
  ```bash
  curl -s http://127.0.0.1:18089/get_info
  curl -s -X POST http://127.0.0.1:18089/json_rpc \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":"0","method":"get_block_count"}'
  ```
- Do **not** invent miner identities, address ownership, or wallet balances from
  Monero raw data.
- Treat `get_coinbase_tx_sum` as an admin RPC with heavy performance cost.
  Historical supply requires an archival node.

### `executor`

- Keep changes surgical and type-safe; do not introduce `any`.
- Use types from `src/types.d.ts`.
- Preserve crash safety: block + transaction writes stay in one transaction.
- Preserve idempotency: replays and restarts must converge to the same DB state.
- Keep `monero_supply_checkpoints` reorg-safe: verify saved `(height, block_hash)`
  against current chain state before appending new checkpoints.
- Never add `fee_amount` into total XMR supply.
- Keep public list endpoints canonical-only by default.
- Keep metrics in the isolated registry under `src/metrics/*`.
- Never commit `.env` files or secrets.

### `review`

- After schema changes, verify SQL matches `src/sink/postgres.ts`.
- After RPC changes, test against a live node.
- After reorg logic changes, verify orphaned rows are preserved and flags flip
  instead of deleting history.
- After supply changes, verify:
  1. checkpoints store `emission_amount`,
  2. hash validation happens before append,
  3. rollback/recompute works from the last valid ancestor.
- After API changes, keep `/openapi.json` and `/docs` in sync.

---

## Key constraints

| Constraint | Reason |
|---|---|
| No `any` types | Strict TS branch; use explicit Monero types |
| No invented validator/miner identities | Monero does not expose a stable validator model |
| No wallet balance / address ownership indexing | Unsafe without chain-native public semantics |
| `emission_amount` only for supply | Fees do not mint new XMR |
| `height + hash` progress anchoring | Height alone is not reorg-safe |
| Preserve orphaned blocks/txs | Reorg debugging and canonical flips need history |
| Canonical-only default public queries | Explorer users should not see side branches by default |
| Per-request RPC timeout + retry cap | No infinite hangs on heavy RPC |
| Bounded metric labels only | Avoid Prometheus cardinality explosions |

---

## Quick start for a new agent

```bash
cd /pool0/chain-data-indexer-monero
cat docs/api.md
cat src/types.d.ts
cat initdb/001-schema.sql
cat src/sink/postgres.ts
cat src/runner/syncRange.ts
cat src/runner/canonicalChain.ts
cat src/runner/supplyBackfill.ts
cat docs/indexer-api.md
corepack enable
yarn install
cp .env.example .env
yarn db:init
yarn build
yarn dev
```

Health: `curl http://localhost:3001/health`  
Metrics: `curl http://localhost:3001/metrics`  
Explorer API: `curl http://localhost:3001/api/v1/stats`

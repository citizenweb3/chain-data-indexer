# Logos Indexer Explorer API

The indexer exposes a read-only HTTP API for explorer frontends on `API_PORT`
(default: `3001`). All responses are JSON and include:

```http
Content-Type: application/json
Cache-Control: no-store
```

Use `/api/v1/*` for all new clients. Unversioned `/api/*` routes are kept as
local-development aliases and should not be used by new integrations.

---

## Common response shapes

### Paginated list

Used by block and validator list endpoints.

```json
{
  "data": [],
  "pagination": {
    "limit": 20,
    "offset": 0,
    "total": 123,
    "has_more": true
  }
}
```

| Field | Type | Description |
|---|---|---|
| `data` | array | Page data. Shape depends on endpoint. |
| `pagination.limit` | number | Effective page size. Default `20`, max `100`. |
| `pagination.offset` | number | Zero-based row offset. Default `0`. |
| `pagination.total` | number | Total rows matching the current filters. |
| `pagination.has_more` | boolean | `true` when another page exists. |

Invalid `limit` / `offset` values are normalized: `limit` defaults to `20` and
is capped at `100`; `offset` defaults to `0`.

### Errors

```json
{ "error": "not_found" }
```

| HTTP status | Error | Meaning |
|---|---|---|
| `404` | `not_found` | Route or requested row does not exist. |
| `405` | `method_not_allowed` | Only `GET` is supported. |
| `500` | `internal_server_error` | Unexpected API/database error. |

---

## Data dictionary

### Block summary

| Field | Type | Description |
|---|---|---|
| `id` | string | Block header ID from `/cryptarchia/blocks`. |
| `parent_block` | string | Parent block header ID. |
| `slot` | number | Slot in which this block was produced. Slots may be empty. |
| `height` | number \| null | Chain height when provided by the node. |
| `block_root` | string | Block root hash from the node API. |
| `leader_key` | string | Public key of the leader/proposer. |
| `voucher_cm` | string | Voucher commitment from proof of leadership. |
| `entropy` | string | Entropy contribution from proof of leadership. |
| `tx_count` | number | Number of transactions in `raw.transactions`. Always `0` in Logos v0.1.2. |
| `finalized` | boolean | `true` after `/cryptarchia/lib-stream` advances past this block height. |
| `indexed_at` | string | PostgreSQL timestamp when the row was first indexed. |

### Validator summary

| Field | Type | Description |
|---|---|---|
| `leader_key` | string | Leader/proposer public key. |
| `blocks_produced` | number | Number of newly inserted canonical rows attributed to this leader. |
| `first_block_slot` | number \| null | First indexed slot for this leader. |
| `last_block_slot` | number \| null | Latest indexed slot for this leader. |
| `updated_at` | string | Timestamp of the latest stats update for this leader. |

---

## Endpoints

### `GET /health`

Health and lag status for operators and container health checks.

```bash
curl http://localhost:3001/health
```

Response:

```json
{
  "status": "ok",
  "last_slot": 1148474,
  "node_tip_slot": 1148480,
  "node_height": 58062,
  "node_mode": "Online",
  "lag_slots": 6,
  "uptime_s": 3600
}
```

| Field | Type | Description |
|---|---|---|
| `status` | `"ok"` \| `"degraded"` \| `"error"` | `ok` when the Logos node responds; `degraded` when node info cannot be fetched; `error` on unexpected health handler errors. |
| `last_slot` | number | Last saved indexer progress slot. |
| `node_tip_slot` | number \| null | Current node tip slot, or `null` if node is unreachable. |
| `node_height` | number \| null | Current node height, or `null` if node is unreachable. |
| `node_mode` | string \| null | Node sync mode (`Online` / `Bootstrapping`) or `null`. |
| `lag_slots` | number \| null | `node_tip_slot - last_slot`, or `null` if node is unreachable. |
| `uptime_s` | number | Indexer process uptime in seconds. |

Status codes: `200` when `status=ok`, `503` for `degraded` or `error`.

---

### `GET /api/v1/stats`

Network/indexer summary for dashboard headers.

```bash
curl http://localhost:3001/api/v1/stats
```

Response:

```json
{
  "total_blocks": 58000,
  "finalized_blocks": 57950,
  "latest_slot": 1148474,
  "latest_height": 58062,
  "leaders_count": 120,
  "last_indexed_slot": 1148474,
  "node_tip_slot": 1148480,
  "node_height": 58062,
  "node_mode": "Online",
  "lag_slots": 6
}
```

| Field | Type | Description |
|---|---|---|
| `total_blocks` | number | Count of indexed block rows. |
| `finalized_blocks` | number | Count of indexed rows marked finalized. |
| `latest_slot` | number \| null | Highest indexed block slot. |
| `latest_height` | number \| null | Highest indexed block height. |
| `leaders_count` | number | Number of leaders in `logos_leaders`. |
| `last_indexed_slot` | number | Last saved indexer progress slot. |
| `node_tip_slot` | number \| null | Current node tip slot, or `null` if unavailable. |
| `node_height` | number \| null | Current node height, or `null` if unavailable. |
| `node_mode` | string \| null | Node sync mode, or `null` if unavailable. |
| `lag_slots` | number \| null | Difference between node tip and saved progress. |

---

### `GET /api/v1/blocks`

Paginated block list. Defaults to finalized blocks only.

```bash
curl "http://localhost:3001/api/v1/blocks?limit=20&offset=0&finalized=true"
```

Query parameters:

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | integer `1..100` | `20` | Page size. Values above `100` are capped. |
| `offset` | integer `>=0` | `0` | Zero-based row offset. |
| `finalized` | `true` \| `false` \| `all` | `true` | Filter by finality. `all` disables the filter. |
| `leader_key` | string | none | Optional leader/proposer key filter. |

Response:

```json
{
  "data": [
    {
      "id": "18b2b264...",
      "parent_block": "741695da...",
      "slot": 1127922,
      "height": 56774,
      "block_root": "89eb0d6a...",
      "leader_key": "9919de73...",
      "voucher_cm": "0ef4be5d...",
      "entropy": "395a4020...",
      "tx_count": 0,
      "finalized": true,
      "indexed_at": "2026-04-28T13:40:00.000Z"
    }
  ],
  "pagination": {
    "limit": 20,
    "offset": 0,
    "total": 58000,
    "has_more": true
  }
}
```

---

### `GET /api/v1/blocks/:id`

Block detail by `header.id`.

```bash
curl http://localhost:3001/api/v1/blocks/18b2b264...
```

Response contains all block summary fields plus `raw`.

```json
{
  "id": "18b2b264...",
  "parent_block": "741695da...",
  "slot": 1127922,
  "height": 56774,
  "block_root": "89eb0d6a...",
  "leader_key": "9919de73...",
  "voucher_cm": "0ef4be5d...",
  "entropy": "395a4020...",
  "tx_count": 0,
  "finalized": true,
  "indexed_at": "2026-04-28T13:40:00.000Z",
  "raw": {
    "header": {},
    "transactions": []
  }
}
```

`raw` is the native JSON object stored from the Logos node response, not a string.
In v0.1.2, `raw.transactions` is always `[]`.

Status codes: `200` on success, `404` when the block ID is unknown.

---

### `GET /api/v1/validators`

Paginated validator/leader stats ordered by `blocks_produced` descending.

```bash
curl "http://localhost:3001/api/v1/validators?limit=20&offset=0"
```

Query parameters:

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | integer `1..100` | `20` | Page size. Values above `100` are capped. |
| `offset` | integer `>=0` | `0` | Zero-based row offset. |

Response:

```json
{
  "data": [
    {
      "leader_key": "9919de73...",
      "blocks_produced": 42,
      "first_block_slot": 1120000,
      "last_block_slot": 1127922,
      "updated_at": "2026-04-28T13:40:00.000Z"
    }
  ],
  "pagination": {
    "limit": 20,
    "offset": 0,
    "total": 120,
    "has_more": true
  }
}
```

---

### `GET /api/v1/validators/:leader_key`

Stats for one leader/proposer key.

```bash
curl http://localhost:3001/api/v1/validators/9919de73...
```

Response: a single validator summary object.

Status codes: `200` on success, `404` when the leader key is unknown.

---

### `GET /api/v1/validators/:leader_key/blocks`

Blocks produced by one leader. This endpoint uses the same response shape and
query parameters as `GET /api/v1/blocks`, except `leader_key` is taken from the
path.

```bash
curl "http://localhost:3001/api/v1/validators/9919de73.../blocks?finalized=all"
```

Query parameters:

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | integer `1..100` | `20` | Page size. |
| `offset` | integer `>=0` | `0` | Zero-based row offset. |
| `finalized` | `true` \| `false` \| `all` | `true` | Filter by finality. |

---

## Notes for explorer frontends

1. Prefer finalized blocks (`finalized=true`, the default) for public views.
2. Use `finalized=all` only for internal/live views that can tolerate forked or
   non-finalized blocks.
3. `tx_count` is always `0` until Logos enables transactions in a later network
   release.
4. All query parameters are snake_case and should be URL-encoded.
5. This API does not expose wallet balances for arbitrary addresses; see
   `docs/future.md` for the privacy limitation.

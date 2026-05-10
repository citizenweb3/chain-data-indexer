# Monero Indexer Explorer API

The indexer exposes a read-only HTTP API on `API_PORT` (default `3001`).

Use `/api/v1/*` for all new clients. Unversioned `/api/*` aliases exist only for
local/dev compatibility.

---

## Common shapes

### Paginated list

```json
{
  "data": [],
  "pagination": {
    "limit": 20,
    "offset": 0,
    "has_more": true
  }
}
```

- `limit`: default `20`, max `100`
- `offset`: default `0`

### Errors

```json
{ "error": "not_found" }
```

| HTTP | Error |
|---|---|
| `404` | `not_found` |
| `405` | `method_not_allowed` |
| `500` | `internal_server_error` |

---

## Endpoints

### `GET /health`

Operational health summary.

Example fields:

| Field | Meaning |
|---|---|
| `status` | `ok`, `degraded`, or `error` |
| `indexed_height` | highest saved canonical height |
| `node_height` | current daemon height |
| `node_target_height` | daemon target height |
| `lag_blocks` | `node_height - indexed_height` |
| `node_synchronized` | whether the daemon reports synced |
| `node_pruned` | whether the daemon is pruned |
| `last_progress_at` | timestamp of latest indexed progress |
| `uptime_s` | process uptime |

Returns `200` when healthy, `503` when degraded/error.

### `GET /api/v1/stats`

Explorer header stats.

Example fields:

| Field | Meaning |
|---|---|
| `total_blocks` | canonical indexed blocks |
| `total_transactions` | transactions in canonical blocks |
| `latest_height` | highest canonical indexed height |
| `latest_timestamp` | latest canonical block timestamp |
| `last_indexed_height` | saved progress height |
| `node_height` | current node height |
| `node_target_height` | current target height |
| `lag_blocks` | node minus indexer |
| `supply_latest_height` | latest supply checkpoint height |
| `supply_latest_emission_atomic` | latest cumulative supply in atomic units |

### `GET /api/v1/blocks`

Paginated block list.

Query parameters:

| Parameter | Default | Meaning |
|---|---|---|
| `limit` | `20` | page size, max `100` |
| `offset` | `0` | row offset |
| `canonical` | `true` | `true`, `false`, or `all` |
| `settled` | `all` | `true`, `false`, or `all` |
| `order` | `desc` | `asc` or `desc` |

Each row includes:

- `height`
- `hash`
- `prev_hash`
- `timestamp`
- `tx_count`
- `size`
- `weight`
- `difficulty`
- `cumulative_difficulty`
- `block_reward_atomic`
- `is_canonical`
- `is_settled`
- `indexed_at`

### `GET /api/v1/blocks/:id`

Block detail by:

- block hash, or
- canonical height

Returns the stored raw block JSON plus summary fields and embedded transaction
summaries for the block.

### `GET /api/v1/transactions`

Paginated transaction list.

Query parameters:

| Parameter | Default | Meaning |
|---|---|---|
| `limit` | `20` | page size, max `100` |
| `offset` | `0` | row offset |
| `canonical` | `true` | `true`, `false`, or `all` |
| `settled` | `all` | `true`, `false`, or `all` |
| `order` | `desc` | `asc` or `desc` |

Each row includes:

- `hash`
- `block_hash`
- `height`
- `timestamp`
- `version`
- `unlock_time`
- `is_coinbase`
- `input_count`
- `output_count`
- `extra_size`
- `fee_atomic`
- `size`
- `is_canonical`
- `is_settled`
- `indexed_at`

### `GET /api/v1/transactions/:id`

Transaction detail by tx hash.

Returns the stored raw transaction JSON plus safe explorer summary fields.

This branch intentionally does **not** infer wallet ownership, sender/recipient
identity, or balance deltas from opaque Monero transaction data.

### `GET /api/v1/supply`

Paginated supply checkpoint series for tokenomics charts.

Query parameters:

| Parameter | Default | Meaning |
|---|---|---|
| `limit` | `100` | page size, max `1000` |
| `offset` | `0` | row offset |
| `order` | `desc` | `asc` or `desc` |

Each row includes:

- `height`
- `block_hash`
- `block_timestamp`
- `cumulative_emission_atomic`
- `cumulative_fee_atomic`
- `source_method`
- `computed_at`

`cumulative_emission_atomic` is the XMR supply series. `cumulative_fee_atomic`
is informational only.

---

## Default explorer semantics

1. Block/transaction list endpoints default to canonical rows.
2. Reorged rows are preserved in storage and only exposed when explicitly asked.
3. `is_settled` is a heuristic based on `SETTLEMENT_DEPTH`, not BFT finality.
4. Supply charts should use `cumulative_emission_atomic`.

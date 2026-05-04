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

Used by block, transaction, and leader-key list endpoints.

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

| Field | Type | Description |
|---|---|---|
| `data` | array | Page data. Shape depends on endpoint. |
| `pagination.limit` | number | Effective page size. Default `20`, max `100`. |
| `pagination.offset` | number | Zero-based row offset. Default `0`. |
| `pagination.has_more` | boolean | `true` when another page exists. |
| `pagination.total` | number | Present on leader-key lists only. Omitted from block lists to avoid expensive public `COUNT(*)` queries on large block tables. |

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
| `height` | number \| null | Canonical chain height. Logos v0.1.2 `/cryptarchia/blocks` usually omits it on ingest, so the indexer derives it from tip/LIB anchors plus `parent_block`. Finalized canonical rows are expected to have a height; `null` may remain on non-canonical or not-yet-anchorable rows outside the current finalized chain. |
| `block_root` | string | Block root hash from the node API. |
| `leader_key` | string | Proof-of-leadership signing key exposed by the block header. It is not a stable validator identity in Logos v0.1.2. |
| `voucher_cm` | string | Voucher commitment from proof of leadership. |
| `entropy` | string | Entropy contribution from proof of leadership. |
| `tx_count` | number | Number of transactions in `raw.transactions`. |
| `finalized` | boolean | `true` only for canonical blocks on the current LIB ancestry. Competing siblings are explicitly kept `false`. |
| `is_canonical` | boolean | `true` only for blocks on the current tip ancestry. Public list endpoints default to `is_canonical=true`. |
| `indexed_at` | string | PostgreSQL timestamp when the row was first indexed. |

### Transaction summary

| Field | Type | Description |
|---|---|---|
| `id` | string | Transaction identifier used by the indexer API. Equals `mantle_tx.hash` when present; otherwise falls back to `block_id:position`. |
| `hash` | string | Transaction hash when present, otherwise the same value as `id`. |
| `tx_hash` | string \| null | Raw `mantle_tx.hash` from the node payload, if present. |
| `block_id` | string | Parent block `header.id`. |
| `position` | number | Zero-based index inside `block.transactions[]`. |
| `slot` | number | Slot of the containing block. |
| `height` | number \| null | Canonical height of the containing block. |
| `finalized` | boolean | Finality of the containing block. |
| `is_canonical` | boolean | Canonical status of the containing block. |
| `op_count` | number | Number of operations in `mantle_tx.ops`. |
| `op_types` | string[] | Safe operation names derived from known Mantle opcodes. Unknown opcodes are returned as `Unknown(0x..)`. |
| `proof_types` | string[] | Safe proof kind names derived from `ops_proofs`. |
| `storage_gas_price` | number \| null | Raw `mantle_tx.storage_gas_price`. |
| `execution_gas_price` | number \| null | Raw `mantle_tx.execution_gas_price`. |
| `indexed_at` | string | Timestamp when the transaction row was first indexed. |

### Safe decoded transaction detail

`GET /api/v1/transactions/:id` and block-detail embedded transaction rows include a
`decoded` object when the node payload contains Mantle operations. This is a
**safe explorer decode**, not a canonical protocol specification.

The indexer only exposes:

- stable opcode names from the current Logos source tree
- proof kind names from `ops_proofs`
- normalized payload fields already present in the node JSON
- compact previews for byte arrays (`hex_preview`, `ascii_fragments`)

It does **not** invent note ownership, transfer sender/recipient semantics, or
high-level meaning for opaque binary metadata / ZK proof payloads.

### Leader-key summary

Logos v0.1.2 exposes `proof_of_leadership.leader_key` in block headers but does
not expose a stable validator/account identity. Treat these rows as proof-key
diagnostics only, not validator statistics. In the current indexed testnet
dataset, each block has a distinct `leader_key`.

| Field | Type | Description |
|---|---|---|
| `leader_key` | string | `proof_of_leadership.leader_key` from block headers. |
| `blocks_with_key` | number | Number of indexed block rows carrying this key. Normally `1` on the current testnet. |
| `first_seen_slot` | number \| null | First indexed slot carrying this key. |
| `last_seen_slot` | number \| null | Latest indexed slot carrying this key. |
| `stable_validator_identity` | boolean | Always `false` for Logos v0.1.2. |
| `identity_scope` | string | Always `proof_of_leadership.leader_key`. |
| `updated_at` | string | Timestamp of the latest key diagnostic update. |

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
  "total_transactions": 1200,
  "finalized_blocks": 57950,
  "latest_slot": 1148474,
  "latest_height": 58062,
  "leader_keys_count": 120,
  "last_indexed_slot": 1148474,
  "node_tip_slot": 1148480,
  "node_height": 58062,
  "node_mode": "Online",
  "lag_slots": 6
}
```

| Field | Type | Description |
|---|---|---|
| `total_blocks` | number | Count of canonical indexed block rows. |
| `total_transactions` | number | Count of indexed transaction rows whose containing block is canonical. |
| `finalized_blocks` | number | Count of canonical indexed rows marked finalized. |
| `latest_slot` | number \| null | Highest indexed canonical block slot. |
| `latest_height` | number \| null | Highest indexed canonical block height. |
| `leader_keys_count` | number | Number of distinct `proof_of_leadership.leader_key` values seen. This is not a validator count. |
| `last_indexed_slot` | number | Last saved indexer progress slot. |
| `node_tip_slot` | number \| null | Current node tip slot, or `null` if unavailable. |
| `node_height` | number \| null | Current node height, or `null` if unavailable. |
| `node_mode` | string \| null | Node sync mode, or `null` if unavailable. |
| `lag_slots` | number \| null | Difference between node tip and saved progress. |

---

### `GET /api/v1/blocks`

Paginated block list. Defaults to **canonical finalized** blocks only.

```bash
curl "http://localhost:3001/api/v1/blocks?limit=20&offset=0&finalized=true&order=desc"
```

Query parameters:

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | integer `1..100` | `20` | Page size. Values above `100` are capped. |
| `offset` | integer `>=0` | `0` | Zero-based row offset. |
| `finalized` | `true` \| `false` \| `all` | `true` | Filter by finality. `all` disables the filter. |
| `canonical` | `true` \| `false` \| `all` | `true` | Filter by canonical-chain membership. `all` exposes stored competing siblings/orphans. |
| `order` | `desc` \| `asc` | `desc` | Sort direction for the selected sort key. |
| `sort` | `height` \| `slot` | `height` | Sort by canonical block height (default) or by raw slot number. |
| `leader_key` | string | none | Optional `proof_of_leadership.leader_key` filter. |

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
      "is_canonical": true,
      "indexed_at": "2026-04-28T13:40:00.000Z"
    }
  ],
  "pagination": {
    "limit": 20,
    "offset": 0,
    "order": "desc",
    "sort": "height",
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

Response contains all block summary fields plus `transactions` and `raw`.

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
  "is_canonical": true,
  "indexed_at": "2026-04-28T13:40:00.000Z",
  "transactions": [],
  "raw": {
    "header": {},
    "transactions": []
  }
}
```

`raw` is the native JSON object stored from the Logos node response, not a string.
`transactions` is a summarized view from `logos_transactions`; `raw.transactions`
is the original node payload.

Status codes: `200` on success, `404` when the block ID is unknown.

---

### `GET /api/v1/transactions`

Paginated transaction list. Defaults to transactions in **canonical finalized**
blocks only.

```bash
curl "http://localhost:3001/api/v1/transactions?limit=20&offset=0&finalized=true&order=desc"
```

Query parameters:

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | integer `1..100` | `20` | Page size. Values above `100` are capped. |
| `offset` | integer `>=0` | `0` | Zero-based row offset. |
| `finalized` | `true` \| `false` \| `all` | `true` | Filter by containing block finality. |
| `canonical` | `true` \| `false` \| `all` | `true` | Filter by containing block canonical status. `all` exposes transactions from orphaned/competing blocks. |
| `order` | `desc` \| `asc` | `desc` | Sort direction for the selected sort key. |
| `sort` | `height` \| `slot` | `height` | Sort by containing block height (default) or slot. |
| `block_id` | string | none | Optional containing block filter. |

Response:

```json
{
  "data": [
    {
      "id": "ebbd8ae2...",
      "hash": "ebbd8ae2...",
      "tx_hash": "ebbd8ae2...",
      "block_id": "133daa76...",
      "position": 0,
      "slot": 1722623,
      "height": 90629,
      "finalized": false,
      "is_canonical": true,
      "op_count": 1,
      "op_types": ["ChannelInscribe"],
      "proof_types": ["Ed25519Sig"],
      "storage_gas_price": 0,
      "execution_gas_price": 0,
      "indexed_at": "2026-05-03T00:00:00.000Z"
    }
  ],
  "pagination": {
    "limit": 20,
    "offset": 0,
    "order": "desc",
    "sort": "height",
    "has_more": true
  }
}
```

---

### `GET /api/v1/transactions/:id`

Transaction detail by transaction ID/hash.

```bash
curl http://localhost:3001/api/v1/transactions/ebbd8ae2...
```

Response contains all transaction summary fields plus `decoded` and `raw`.

Example:

```json
{
  "id": "ebbd8ae2...",
  "hash": "ebbd8ae2...",
  "tx_hash": "ebbd8ae2...",
  "block_id": "133daa76...",
  "position": 0,
  "slot": 1722623,
  "height": 90629,
  "finalized": false,
  "is_canonical": true,
  "op_count": 1,
  "op_types": ["ChannelInscribe"],
  "proof_types": ["Ed25519Sig"],
  "storage_gas_price": 0,
  "execution_gas_price": 0,
  "indexed_at": "2026-05-03T00:00:00.000Z",
  "decoded": {
    "format": "safe-explorer-v1",
    "op_count": 1,
    "proof_count": 1,
    "op_types": ["ChannelInscribe"],
    "proof_types": ["Ed25519Sig"],
    "ops": [
      {
        "index": 0,
        "opcode": 17,
        "opcode_name": "ChannelInscribe",
        "proof_type": "Ed25519Sig",
        "payload": {
          "channel_id": "010101...",
          "parent": "a560b9...",
          "signer": "0e5775...",
          "inscription": {
            "format": "bytes",
            "length": 320,
            "hex_preview": "da63000000000000...",
            "truncated": true,
            "ascii_fragments": ["/LEZ/ClockProgramAccount/..."]
          }
        }
      }
    ]
  },
  "raw": {}
}
```

Status codes: `200` on success, `404` when the transaction ID is unknown.

---

### `GET /api/v1/leader-keys`

Paginated proof leader-key diagnostics ordered by `blocks_with_key` descending.
These rows are **not validator identities**; they are keyed by
`proof_of_leadership.leader_key` as exposed in Logos v0.1.2 block headers.

```bash
curl "http://localhost:3001/api/v1/leader-keys?limit=20&offset=0"
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
      "blocks_with_key": 1,
      "first_seen_slot": 1127922,
      "last_seen_slot": 1127922,
      "stable_validator_identity": false,
      "identity_scope": "proof_of_leadership.leader_key",
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

### `GET /api/v1/validators`

Deprecated. Logos v0.1.2 does not expose stable validator identities, so this
endpoint returns `410 validator_identity_unavailable`.

Use `GET /api/v1/leader-keys` for proof-key diagnostics.

---

### `GET /api/v1/validators/:leader_key`

Deprecated. Logos v0.1.2 does not expose stable validator identities, so this
endpoint returns `410 validator_identity_unavailable`.

Use `GET /api/v1/leader-keys/:leader_key` for proof-key diagnostics.

### `GET /api/v1/leader-keys/:leader_key`

Diagnostics for one `proof_of_leadership.leader_key`.

```bash
curl http://localhost:3001/api/v1/leader-keys/9919de73...
```

Response: a single leader-key summary object.

Status codes: `200` on success, `404` when the leader key is unknown.

---

### `GET /api/v1/validators/:leader_key/blocks`

Deprecated. Returns `410 validator_identity_unavailable`.

Use `GET /api/v1/leader-keys/:leader_key/blocks` instead.

### `GET /api/v1/leader-keys/:leader_key/blocks`

Blocks carrying one `proof_of_leadership.leader_key`. This endpoint uses the
same response shape and query parameters as `GET /api/v1/blocks`, except
`leader_key` is taken from the path.

```bash
curl "http://localhost:3001/api/v1/leader-keys/9919de73.../blocks?finalized=all"
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
3. Prefer `GET /api/v1/transactions` for explorer transaction pages; `raw.transactions`
   on block detail remains the unmodified node payload.
4. Public list endpoints default to `canonical=true`; use `canonical=all` only
   for debugging stored side branches and orphaned transactions.
5. Treat `decoded` as an explorer convenience layer. For protocol-accurate
   binary details, fall back to `raw`.
4. All query parameters are snake_case and should be URL-encoded.
5. This API does not expose wallet balances for arbitrary addresses; see
   `docs/future.md` for the privacy limitation.

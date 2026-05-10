# Monero Node RPC — Surface Used by the Indexer

This document describes the upstream Monero daemon RPC surface consumed by this
indexer branch. For the indexer's own explorer API, see
[`docs/indexer-api.md`](indexer-api.md).

Node version target: **monerod v0.18.4.6**

---

## Endpoints used

| Method | Path | Purpose | Notes |
|---|---|---|---|
| POST | `/json_rpc` `get_info` | sync state, target height, health | primary health source |
| POST | `/json_rpc` `get_block_count` | tip height | stable during sync |
| POST | `/json_rpc` `get_block` | block body by height/hash | main backfill source |
| POST | `/json_rpc` `get_block_header_by_height` | block hash/timestamp lookup | reorg anchoring |
| POST | `/get_transactions` | raw tx bodies for tx hashes | batched per block batch |
| POST | `/json_rpc` `get_coinbase_tx_sum` | supply checkpoints | admin-only, expensive |
| POST | `/json_rpc` `prune_blockchain` with `{"check":true}` | detect pruned vs archival | historical supply requires archival |
| POST | `/json_rpc` `sync_info` | optional sync diagnostics | useful for troubleshooting |
| POST | `/json_rpc` `get_alternate_chains` | optional reorg diagnostics | troubleshooting/debug only |

---

## Important RPC behavior

### `get_info`

```bash
curl -s -X POST http://127.0.0.1:18089/json_rpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"0","method":"get_info"}'
```

Used for:

- daemon reachability,
- current height / target height,
- syncing state,
- busy flag / net state,
- node mode shown in `/health`.

The indexer treats this as the primary operational heartbeat.

### `get_block_count`

```bash
curl -s -X POST http://127.0.0.1:18089/json_rpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"0","method":"get_block_count"}'
```

Used for tip height. This is preferred over `get_last_block_header` during sync,
because Monero may report `"status":"BUSY"` on some header-oriented calls while
initial sync is still underway.

### `get_block`

```bash
curl -s -X POST http://127.0.0.1:18089/json_rpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"0","method":"get_block","params":{"height":1}}'
```

Returns a block envelope that includes:

- `blob`
- `json` / block body
- `block_header`

The indexer uses `get_block` as the source of truth for stored raw block rows.

### `/get_transactions`

```bash
curl -s -X POST http://127.0.0.1:18089/get_transactions \
  -H 'Content-Type: application/json' \
  -d '{"txs_hashes":["<tx_hash>"],"decode_as_json":true,"prune":false}'
```

Used to fetch transaction payloads for all non-coinbase tx hashes referenced by
indexed blocks. Batched calls are safer than one-request-per-transaction.

### `get_coinbase_tx_sum`

```bash
curl -s -X POST http://127.0.0.1:18089/json_rpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"0","method":"get_coinbase_tx_sum","params":{"height":0,"count":25000}}'
```

Returns:

- `emission_amount`
- `fee_amount`

**Supply rule:** only `emission_amount` contributes to XMR total supply.
`fee_amount` is recorded for audit/diagnostics but must not be added to supply.

Operational notes:

- admin-only RPC,
- can be very slow on large ranges,
- unsuitable as one giant hourly full-range query,
- historical checkpoints require an archival node.

### `prune_blockchain` with `check=true`

```bash
curl -s -X POST http://127.0.0.1:18089/json_rpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"0","method":"prune_blockchain","params":{"check":true}}'
```

Used to detect whether the daemon is pruned. If pruned, the indexer should avoid
historical supply bootstrap and report degraded supply capability.

---

## RPC design rules for this branch

1. Every RPC call must have a timeout.
2. Retry only transient failures.
3. Never assume normal JSON parsing is safe for Monero monetary values; use
   big-int-safe parsing for RPC payloads that may contain large integers.
4. Do not use undocumented semantics from raw Monero JSON. Store raw payloads and
   expose only safe explorer summaries.
5. If Monero adds a better bulk block RPC in a future release, document it here
   before changing ingestion.

# Logos Blockchain Node — HTTP API Reference

This document describes the upstream Logos node API consumed by the indexer.
For the indexer's own explorer API, see [`docs/indexer-api.md`](indexer-api.md).

Node version: **0.1.2** (testnet)  
Default listen address: `0.0.0.0:8080` (configurable via `api.backend.listen_address` in `user_config.yaml`)  
All endpoints are unauthenticated and local-only by default.

Source of truth: [`nodes/api-common/src/paths.rs`](https://github.com/logos-blockchain/logos-blockchain/blob/master/nodes/api-common/src/paths.rs) and [`nodes/node/binary/src/api/backend.rs`](https://github.com/logos-blockchain/logos-blockchain/blob/master/nodes/node/binary/src/api/backend.rs).

---

## Endpoint availability in v0.1.2

| Method | Path | Status in 0.1.2 | Description |
|--------|------|-----------------|-------------|
| GET | `/cryptarchia/info` | ✅ | Consensus + sync state |
| GET | `/cryptarchia/headers` | ✅ | Recent fork-choice header IDs |
| GET | `/cryptarchia/lib-stream` | ✅ NDJSON | Last irreversible block stream |
| GET | `/cryptarchia/blocks` | ✅ | Blocks in slot range |
| GET | `/cryptarchia/events/blocks/stream` | ✅ SSE | Live block stream |
| GET | `/network/info` | ✅ | P2P peer + connection info |
| GET | `/wallet/:public_key/balance` | ✅ | Wallet balance and notes |
| POST | `/storage/block` | ✅ | Block by hash (body = JSON string) |
| POST | `/mempool/add/tx` | ✅ | Submit a transaction |
| GET | `/cryptarchia/blocks/:id` | ❌ 404 | Not enabled in v0.1.2 |
| GET | `/cryptarchia/transaction/:id` | ❌ 404 | Not enabled in v0.1.2 |
| GET | `/blend/info` | ❌ 404 | Blend Network — planned for v0.2 |
| GET | `/mantle/metrics` | ❌ 404 | Not enabled in v0.1.2 |
| POST | `/mantle/status` | ❌ 404 | Not enabled in v0.1.2 |
| POST | `/wallet/transactions/transfer-funds` | ❌ 404 | Not enabled in v0.1.2 |
| POST | `/wallet/sign/ed25519` | ❌ 404 | Not enabled in v0.1.2 |
| POST | `/wallet/sign/zk` | ❌ 404 | Not enabled in v0.1.2 |
| GET | `/channel/:id` | ❌ 404 | Not enabled in v0.1.2 |
| POST | `/channel/deposit` | ❌ 404 | Not enabled in v0.1.2 |
| POST | `/sdp/declaration` | ❌ 404 | Not enabled in v0.1.2 |
| POST | `/sdp/activity` | ❌ 404 | Not enabled in v0.1.2 |
| POST | `/sdp/withdrawal` | ❌ 404 | Not enabled in v0.1.2 |
| POST | `/leader/claim` | ❌ 404 | Not enabled in v0.1.2 |

---

## Endpoints — detailed reference

### GET `/cryptarchia/info`

Returns consensus state, sync progress, and current chain tip.

```bash
curl http://localhost:8080/cryptarchia/info
```

Response:
```json
{
  "lib":      "56174b26...",   // last irreversible block (LIB) hash
  "lib_slot": 1121932,         // slot of the LIB
  "tip":      "8f7523a0...",   // current chain tip hash
  "slot":     1122640,         // current slot number
  "height":   56774,           // block height at tip
  "mode":     "Online"         // "Bootstrapping" during IBD, "Online" when synced
}
```

Key fields for an explorer:
- `height` — current block height
- `slot` — current slot (target: 20s per slot)
- `mode` — `"Online"` means fully synced; `"Bootstrapping"` means IBD in progress
- `lib` / `lib_slot` — last finalized block

---

### GET `/network/info`

Returns P2P network identity and peer connectivity.

```bash
curl http://localhost:8080/network/info
```

Response:
```json
{
  "listen_addresses": [
    "/ip4/192.168.5.215/udp/3000/quic-v1",
    ...
  ],
  "peer_id":             "12D3KooWPMT8rZHu8oBQMTW5VaWUDp52sBcHXQCLan42zJXZsbs8",
  "n_peers":             23,
  "n_connections":       23,
  "n_pending_connections": 0
}
```

---

### GET `/cryptarchia/headers`

Returns the list of block header IDs currently tracked in the local fork-choice tree (last ~31 headers).

```bash
curl http://localhost:8080/cryptarchia/headers
```

Response: JSON array of hex-encoded header IDs.

```json
[
  "2a7adcb17c20c7b3...",
  "d29f1186d4865...",
  ...
]
```

---

### GET `/cryptarchia/blocks?slot_from=X&slot_to=Y`

Returns blocks in a slot range. Both parameters are required.

```bash
curl "http://localhost:8080/cryptarchia/blocks?slot_from=1128000&slot_to=1128010"
```

Query parameters:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `slot_from` | integer ≥ 0 | ✅ | Start of slot range (inclusive) |
| `slot_to` | integer ≥ 0 | ✅ | End of slot range (inclusive) |

Response: JSON array of block objects.

```json
[
  {
    "header": {
      "id":           "18b2b264...",       // block header ID
      "parent_block": "741695da...",       // parent block header ID
      "slot":         1127922,
      "block_root":   "89eb0d6a...",
      "proof_of_leadership": {
        "proof":               [160, 12, ...],  // 128-byte Groth16 proof
        "entropy_contribution": "395a4020...",
        "leader_key":           "9919de73...",  // leader's public key
        "voucher_cm":           "0ef4be5d..."   // voucher commitment
      }
    },
    "transactions": []
  }
]
```

Returns `[]` if no blocks were produced in the given range.

---

### GET `/cryptarchia/lib-stream`

NDJSON stream that emits each new last irreversible block (LIB) update.

```bash
curl -N http://localhost:8080/cryptarchia/lib-stream
```

Observed response line:

```json
{"height":59390,"header_id":"77bcd6960f6c5e9f824733137c87298ce6d35d3c1fc8b2be44ab1d235cff26ef"}
```

The HTTP response content type is `application/x-ndjson`. Use a streaming HTTP
client plus line parsing; do not use EventSource for this endpoint.

---

### GET `/cryptarchia/events/blocks/stream`

Server-Sent Events (SSE) stream that emits each newly accepted block in real time.

```bash
curl -N http://localhost:8080/cryptarchia/events/blocks/stream
```

---

### GET `/wallet/:public_key/balance`

Returns the current balance and UTXO notes for a wallet key.

```bash
curl http://localhost:8080/wallet/20385ef66ea93c145e2d2485d728dae9349acb95c8b1806607d724c05a57dc1a/balance
```

Path parameter: `public_key` — 64-character hex key from `wallet.known_keys` in `user_config.yaml`.

Response:
```json
{
  "tip":     "8f7523a0...",
  "balance": 1000,
  "notes": {
    "c73f3f3a...": 1000
  },
  "address": "20385ef6..."
}
```

Returns HTTP 400 with `"Requested wallet state for unknown block: ..."` if the node is still in IBD (not yet `Online`).

---

### POST `/storage/block`

Returns full block data by block hash. Body must be a JSON-encoded hex string (with quotes).

```bash
# Get the current tip hash first
TIP=$(curl -s http://localhost:8080/cryptarchia/info | python3 -c "import sys,json; print(json.load(sys.stdin)['tip'])")

curl -s -X POST http://localhost:8080/storage/block \
  -H "Content-Type: application/json" \
  -d "\"$TIP\""
```

Request body: `"<64-char hex block hash>"` (JSON string)

Response:
```json
{
  "header": {
    "version":    "Bedrock",
    "parent_block": "1d7c9927...",
    "slot":         1128063,
    "block_root":   "52c289ed...",
    "proof_of_leadership": {
      "proof":               [52, 213, ...],
      "entropy_contribution": "...",
      "leader_key":           "...",
      "voucher_cm":           "..."
    }
  },
  "signature":     [210, 99, ...],
  "transactions":  []
}
```

Note: `header` here does not include `id` (unlike `/cryptarchia/blocks`). The proof field is a raw byte array (128 bytes).

---

### POST `/mempool/add/tx`

Submit a signed transaction to the mempool.

```bash
curl -X POST http://localhost:8080/mempool/add/tx \
  -H "Content-Type: application/json" \
  -d '{ "mantle_tx": { ... } }'
```

Request body must contain a `mantle_tx` field with a serialized signed transaction. Returns HTTP 422 if the body is malformed.

---

## Notes for explorer integration

1. **Sync check**: poll `GET /cryptarchia/info` — only trust data when `"mode": "Online"`.
2. **Latest block height**: `height` from `/cryptarchia/info`.
3. **Block pagination**: use `/cryptarchia/blocks?slot_from=X&slot_to=Y`. Slots are not 1:1 with blocks — some slots produce no block.
4. **Block detail**: use `POST /storage/block` with the block's hash (tip hash or parent hash from another block). The `header.id` returned by `/cryptarchia/blocks` is **not** the hash expected by `/storage/block` — use the tip/parent chain hashes instead.
5. **Real-time**: subscribe to `/cryptarchia/events/blocks/stream` (SSE) for live block feed.
6. **Peer count**: `n_peers` from `/network/info`.
7. **No public transaction lookup**: `/cryptarchia/transaction/:id` returns 404 in v0.1.2 — transaction history is only queryable via wallet balance notes.
8. **No built-in explorer**: Logos does not ship a block explorer in v0.1.2; the official dashboard at `https://testnet.blockchain.logos.co/web/` only shows team bootstrap nodes and requires auth.

## Planned for v0.2

- `/blend/info` — Blend Network proposer privacy info
- Mantle endpoints (`/mantle/metrics`, `/mantle/status`)
- SDP (zone) endpoints
- Transaction lookup by ID

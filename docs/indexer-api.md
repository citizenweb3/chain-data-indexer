# Miden indexer explorer API

Base URL: `http://<host>:<INDEXER_HTTP_PORT>`. All explorer endpoints are read-only. Versioned endpoints live under `/api/v1`; `/health` is unversioned for load balancers.

## Encoding and response conventions

- `BYTEA` database columns are returned as lower-case hex strings with no `0x` prefix.
- Hex path/query parameters must contain only hex characters and have the exact expected byte length. Invalid values return `400 { "error": "invalid hex", "code": "INVALID_HEX" }`.
- Most `BIGINT` columns are returned as JSON strings to avoid JavaScript 53-bit precision loss. Block lineage fields backed by Miden `fixed32`/bounded block numbers (`block_num`, `last_block`, `expiration_block_num`, `last_block_num`, `chain_length`) are returned as JSON numbers so explorer consumers can sort them numerically without client-side coercion.
- Timestamps are JSON strings produced from PostgreSQL `TIMESTAMPTZ` values.
- List endpoints use `limit`/`offset` pagination and return `{ data, total, limit, offset }`. `limit` defaults to `20` and is clamped to `1..100`; `offset` defaults to `0`, must be non-negative, and is capped at `100000` (a `400 OFFSET_TOO_LARGE` is returned above the cap — narrow the filter or page from the other end). `total` is computed via `COUNT(*)` and cached for ~5 s per (table, filter) combination.
- Errors never include stack traces. Stable error bodies are `{ error: string, code: string }`.

## Types

```ts
type Page<T> = { data: T[]; total: number; limit: number; offset: number };
type Hex = string;
type BigIntString = string;
type BlockNumber = number;
type Timestamp = string;

type BlockSummary = {
  block_num: BlockNumber;
  block_hash: Hex;
  block_commitment: Hex | null;
  prev_block_commitment: Hex;
  chain_commitment: Hex;
  account_root: Hex;
  nullifier_root: Hex;
  note_root: Hex;
  tx_commitment: Hex;
  validator_key: Hex;
  tx_kernel_commitment: Hex;
  proof_commitment: Hex;
  native_asset_id: Hex;
  verification_base_fee: BigIntString;
  timestamp: Timestamp;
  tx_count: number;
  note_count: number;
  nullifier_count: number;
  version: number | null;
  chain_length: BlockNumber | null;
  inserted_at: Timestamp;
};
type Block = BlockSummary & { raw_block_bytes: Hex | null };

type Transaction = {
  tx_id: Hex;
  block_num: BlockNumber;
  account_id: Hex;
  account_id_bech32: string | null;
  init_account_state: Hex | null;
  final_account_state: Hex | null;
  input_notes_commitment: Hex | null;
  output_notes_commitment: Hex | null;
  expiration_block_num: BlockNumber | null;
  input_nullifiers: Hex[] | null;
  output_note_ids: Hex[] | null;
  inserted_at: Timestamp;
};

type Note = {
  note_id: Hex;
  block_num: BlockNumber;
  note_index: number;
  is_public: boolean;
  metadata: Hex;
  sender: Hex | null;
  tag: BigIntString | null;
  note_type: number | null;
  attachment: Hex | null;
  aux: BigIntString | null;
  execution_hint: BigIntString | null;
  recipient_digest: Hex | null;
  assets: Hex | null;
  script_root: Hex | null;
  inputs_hash: Hex | null;
  serial_num: Hex | null;
  note_details: Hex | null;
  inserted_at: Timestamp;
};

type Nullifier = {
  nullifier: Hex;
  block_num: BlockNumber;
  consumed_note_id: Hex | null;
  inserted_at: Timestamp;
};

type Account = {
  account_id: Hex;
  account_id_bech32: string | null;
  is_public: boolean;
  last_block_num: BlockNumber;
  account_commitment: Hex;
  nonce: BigIntString | null;
  code_commitment: Hex | null;
  storage_commitment: Hex | null;
  vault_root: Hex | null;
  account_type: number | null;
  storage_mode: number | null;
  updated_at: Timestamp;
};
```

## Health, metrics and stats

### `GET /health`

Returns API/database health. The server returns `200` when PostgreSQL responds to `SELECT 1`; otherwise `503` with an error body. `lag_blocks` is `chain_tip - last_block` when the runner supplies a cached chain tip, otherwise `null`.

Response:

```ts
{ ok: true; lag_blocks: number | null; last_block: BlockNumber | null; uptime_s: number; version: string }
```

Status codes: `200`, `503`.

Example:

```sh
curl http://127.0.0.1:3001/health
```

### `GET /metrics`

Prometheus text-exposition endpoint with the fleet-wide `miden_*` (domain) and
`miden_node_*` (Node.js runtime) prefixes. Cardinality is intentionally bounded:
allowed labels are limited to `module`, `level`, `endpoint`, `group`, `table`,
`phase`, `status`. The endpoint is gated by `METRICS_ENABLED` (default `true`).
See [`docs/observability/`](observability/) for ready-to-use Alloy / Prometheus
/ Promtail configurations.

Example:

```sh
curl http://127.0.0.1:3001/metrics | head -20
```

### `GET /api/v1/stats`

Returns aggregate indexer counters. Counts come from `count(*)` and are cached
in-process for 5 seconds to keep public traffic from running repeated full table
scans.

Response:

```ts
{
  last_block: BlockNumber;
  total_blocks: number;
  total_transactions: number;
  total_notes: number;
  total_nullifiers: number;
  total_accounts: number;
  latest_block_timestamp: Timestamp | null;
  tps: number;
}
```

Status codes: `200`, `500`.

Example:

```sh
curl http://127.0.0.1:3001/api/v1/stats
```

## Blocks

### `GET /api/v1/blocks?limit=&offset=&order=desc|asc`

Lists block summaries. `order` defaults to `desc` and sorts by `block_num`.
For blocks that already have a successor row, `block_commitment` is derived from
the successor header's `prev_block_commitment`, which is the public protocol
commitment of the listed block. The current tip may return `block_commitment:
null` until the next block is indexed.

Response: `Page<BlockSummary>`.

Status codes: `200`, `400`, `500`.

Example:

```sh
curl 'http://127.0.0.1:3001/api/v1/blocks?limit=20&offset=0&order=desc'
```

### `GET /api/v1/blocks/:n[?include_raw=true]`

Returns one block summary by numeric `block_num`. The `raw_block_bytes` hex column is omitted by default to keep responses bounded; pass `?include_raw=true` to receive it. Block bytes can reach 64 MiB raw / ~128 MiB hex, so callers that need the blob should also size their HTTP buffers accordingly.

`block_hash` is the branch-local indexer identifier documented in
`docs/schema.md`. `block_commitment`, when non-null, is the Miden protocol block
commitment observed from the successor header.

Response: `Block` (with `raw_block_bytes` only when requested).

Status codes: `200`, `400`, `404`, `500`.

Example:

```sh
curl http://127.0.0.1:3001/api/v1/blocks/1
curl 'http://127.0.0.1:3001/api/v1/blocks/1?include_raw=true'
```

### `GET /api/v1/blocks/by-hash/:hex[?include_raw=true]`

Returns one block summary by 32-byte block hash (`64` hex characters). `raw_block_bytes` is opt-in via `?include_raw=true`, same semantics as the numeric variant.

Response: `Block`.

Status codes: `200`, `400`, `404`, `500`.

Example:

```sh
curl http://127.0.0.1:3001/api/v1/blocks/by-hash/0000000000000000000000000000000000000000000000000000000000000000
```

## Transactions

### `GET /api/v1/transactions?limit=&offset=&block_num=&account_id=`

Lists transactions, optionally filtered by decimal `block_num` and 15-byte account ID hex.

Response: `Page<Transaction>`.

Status codes: `200`, `400`, `500`.

Example:

```sh
curl 'http://127.0.0.1:3001/api/v1/transactions?limit=20&offset=0&block_num=1'
```

### `GET /api/v1/transactions/:tx_id_hex`

Returns one transaction by 32-byte transaction ID hex.

Response: `Transaction`.

Status codes: `200`, `400`, `404`, `500`.

Example:

```sh
curl http://127.0.0.1:3001/api/v1/transactions/1111111111111111111111111111111111111111111111111111111111111111
```

## Notes

### `GET /api/v1/notes?limit=&offset=&block_num=&sender_hex=&tag=&is_public=`

Lists notes, optionally filtered by decimal `block_num`, 15-byte sender account ID hex, numeric tag, and `is_public=true|false`.

Response: `Page<Note>`.

Status codes: `200`, `400`, `500`.

Example:

```sh
curl 'http://127.0.0.1:3001/api/v1/notes?limit=20&offset=0&is_public=true'
```

### `GET /api/v1/notes/:note_id_hex`

Returns one note by 32-byte note ID hex.

Response: `Note`.

Status codes: `200`, `400`, `404`, `500`.

Example:

```sh
curl http://127.0.0.1:3001/api/v1/notes/2222222222222222222222222222222222222222222222222222222222222222
```

## Nullifiers

### `GET /api/v1/nullifiers?limit=&offset=&block_num=`

Lists nullifiers, optionally filtered by decimal `block_num`.

Response: `Page<Nullifier>`.

Status codes: `200`, `400`, `500`.

Example:

```sh
curl 'http://127.0.0.1:3001/api/v1/nullifiers?limit=20&offset=0&block_num=1'
```

### `GET /api/v1/nullifiers/:nullifier_hex`

Returns one nullifier by 32-byte nullifier hex.

Response: `Nullifier`.

Status codes: `200`, `400`, `404`, `500`.

Example:

```sh
curl http://127.0.0.1:3001/api/v1/nullifiers/3333333333333333333333333333333333333333333333333333333333333333
```

## Accounts

### `GET /api/v1/accounts?limit=&offset=&is_public=`

Lists current account states, optionally filtered by `is_public=true|false`.

Response: `Page<Account>`.

Status codes: `200`, `400`, `500`.

Example:

```sh
curl 'http://127.0.0.1:3001/api/v1/accounts?limit=20&offset=0&is_public=true'
```

### `GET /api/v1/accounts/:account_id_hex`

Returns one latest account state by 15-byte account ID hex.

Response: `Account`.

Status codes: `200`, `400`, `404`, `500`.

Example:

```sh
curl http://127.0.0.1:3001/api/v1/accounts/444444444444444444444444444444
```

## Stability notes

This API is pre-v1. Field names mirror the current PostgreSQL schema and may change before v1 if protocol decoding changes. Coverage for transactions, notes, nullifiers, and accounts depends on configured indexer discovery inputs until global/raw-block decoding is complete. Aggregate counts are exact queries today and may move to maintained counters without changing response fields.

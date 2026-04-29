# Miden indexer explorer API

Base URL: `http://<host>:<INDEXER_HTTP_PORT>`. All explorer endpoints are read-only. Versioned endpoints live under `/api/v1`; `/health` is unversioned for load balancers.

## Encoding and response conventions

- `BYTEA` database columns are returned as lower-case hex strings with no `0x` prefix.
- Hex path/query parameters must contain only hex characters and have the exact expected byte length. Invalid values return `400 { "error": "invalid hex", "code": "INVALID_HEX" }`.
- `BIGINT` columns are returned as JSON strings to avoid JavaScript 53-bit precision loss. Counts and pagination totals are JSON numbers at current data volume.
- Timestamps are JSON strings produced from PostgreSQL `TIMESTAMPTZ` values.
- List endpoints use `limit`/`offset` pagination and return `{ data, total, limit, offset }`. `limit` defaults to `20` and is clamped to `1..100`; `offset` defaults to `0` and must be non-negative.
- Errors never include stack traces. Stable error bodies are `{ error: string, code: string }`.

## Types

```ts
type Page<T> = { data: T[]; total: number; limit: number; offset: number };
type Hex = string;
type BigIntString = string;
type Timestamp = string;

type BlockSummary = {
  block_num: BigIntString;
  block_hash: Hex;
  prev_block_commitment: Hex;
  chain_commitment: Hex;
  account_root: Hex;
  nullifier_root: Hex;
  note_root: Hex;
  tx_commitment: Hex;
  validator_key: Hex;
  tx_kernel_commitment: Hex;
  native_asset_id: Hex;
  verification_base_fee: BigIntString;
  timestamp: Timestamp;
  tx_count: number;
  note_count: number;
  nullifier_count: number;
  version: number | null;
  chain_length: BigIntString | null;
  inserted_at: Timestamp;
};
type Block = BlockSummary & { raw_block_bytes: Hex | null };

type Transaction = {
  tx_id: Hex;
  block_num: BigIntString;
  account_id: Hex;
  init_account_state: Hex | null;
  final_account_state: Hex | null;
  input_notes_commitment: Hex | null;
  output_notes_commitment: Hex | null;
  expiration_block_num: BigIntString | null;
  input_nullifiers: Hex[] | null;
  output_note_ids: Hex[] | null;
  inserted_at: Timestamp;
};

type Note = {
  note_id: Hex;
  block_num: BigIntString;
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
  block_num: BigIntString;
  consumed_note_id: Hex | null;
  inserted_at: Timestamp;
};

type Account = {
  account_id: Hex;
  is_public: boolean;
  last_block_num: BigIntString;
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

## Health and stats

### `GET /health`

Returns API/database health. The server returns `200` when PostgreSQL responds to `SELECT 1`; otherwise `503` with an error body. `lag_blocks` is `chain_tip - last_block` when the runner supplies a cached chain tip, otherwise `null`.

Response:

```ts
{ ok: true; lag_blocks: number | null; last_block: BigIntString | null; uptime_s: number; version: string }
```

Status codes: `200`, `503`.

Example:

```sh
curl http://127.0.0.1:3001/health
```

### `GET /api/v1/stats`

Returns aggregate indexer counters. Counts are exact `count(*)` values for now.

Response:

```ts
{
  last_block: BigIntString;
  total_blocks: number;
  total_transactions: number;
  total_notes: number;
  total_nullifiers: number;
  total_accounts: number;
  latest_block_timestamp: Timestamp | null;
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

Response: `Page<BlockSummary>`.

Status codes: `200`, `400`, `500`.

Example:

```sh
curl 'http://127.0.0.1:3001/api/v1/blocks?limit=20&offset=0&order=desc'
```

### `GET /api/v1/blocks/:n`

Returns one full block by numeric `block_num`, including `raw_block_bytes` hex when present.

Response: `Block`.

Status codes: `200`, `400`, `404`, `500`.

Example:

```sh
curl http://127.0.0.1:3001/api/v1/blocks/1
```

### `GET /api/v1/blocks/by-hash/:hex`

Returns one full block by 32-byte block hash (`64` hex characters).

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

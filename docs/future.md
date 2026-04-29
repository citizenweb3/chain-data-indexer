# Logos Indexer for v0.2+ (planned features)

This document describes functionality that is **not yet active** in Logos v0.1.2 but is planned
for v0.2. The schema and architecture are designed to accommodate these features without
requiring a full re-architecture or data migration — because every major Logos testnet version
restarts with a new genesis block, the indexer will simply be re-run from slot 0.

---

## Transactions (v0.2+)

In v0.1.2, `block.transactions` is always `[]`.

Starting in v0.2, blocks will contain `mantle_tx` objects. Each transaction will look roughly like:

```json
{
  "id": "tx_hash_hex",
  "inputs": [
    { "note_id": "commitment_hex", "proof": [...] }
  ],
  "outputs": [
    { "commitment": "new_note_hex", "value": 100 }
  ]
}
```

**Implementation plan:**
1. Uncomment `logos_transactions` and `logos_notes` tables in `initdb/001-schema.sql`
2. Add `MantleTx`, `MantleTxInput`, `MantleTxOutput` types to `src/types.d.ts`
3. In `src/sink/postgres.ts`, implement `upsertTransaction` and `upsertNote`
4. In `processBlock()`, parse `block.transactions` and call those functions
5. Re-run indexer from slot 0 on the new genesis

For the full network upgrade workflow, including when to edit `001-schema.sql`
versus creating a new migration file, see [`network-upgrades.md`](network-upgrades.md).

---

## Schema Migrations

For Logos testnet resets with a new genesis, the preferred approach is usually a
fresh database or full truncate/re-index from slot 0. For networks where data
must be preserved, create additive migration files (`initdb/002-*.sql`) instead
of rewriting the already-applied schema.

Recommended procedure for transaction support:

1. Stop the indexer.
2. Confirm the new block/transaction JSON shape against a live upgraded node.
3. Add or apply a migration for transaction/note tables.
4. Update `src/types.d.ts`, `src/sink/postgres.ts`, and `docs/indexer-api.md`.
5. Reset progress only if the network has restarted from a new genesis.
6. Run `npm run build` and Docker build validation.
7. Restart the indexer and verify `/health` plus `/api/v1/stats`.

---

## Wallet Balances (privacy limitation)

Logos is a **privacy-first** chain. UTXO notes are Zero-Knowledge commitments.
The HTTP API endpoint `GET /wallet/:key/balance` only works for keys that are registered
in the **local node's wallet** (`wallet.known_keys` in `user_config.yaml`).

Querying the balance of an arbitrary foreign address returns `400 Bad Request` with a
cryptographic error — the node cannot decrypt ZK notes it does not own.

**Consequence for explorer:**
There is no way to show balances for all network participants in v0.1.2.
If a future API version exposes public aggregate balance data or a dedicated balance RPC,
the reserved tables `logos_watched_addresses` and `logos_balance_snapshots`
(commented out in `001-schema.sql`) can be activated.

---

## Blend Network / Proposer Privacy (v0.2+)

`GET /blend/info` returns 404 in v0.1.2. When v0.2 adds the Blend Network for proposer
privacy, this endpoint will return metadata about mix-net rounds and anonymity sets.

---

## Zone / Mantle Endpoints (v0.2+)

`/mantle/metrics`, `/mantle/status`, `/sdp/*`, `/channel/*` are all 404 in v0.1.2.
These support decentralised Zone sequencing and token bridging planned for v0.2.

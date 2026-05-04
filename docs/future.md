# Logos Indexer for v0.2+ (planned features)

This document describes functionality that is **not yet active** in Logos v0.1.2 but is planned
for v0.2. The schema and architecture are designed to accommodate these features without
requiring a full re-architecture or data migration — because every major Logos testnet version
restarts with a new genesis block, the indexer will simply be re-run from slot 0.

---

## Transactions beyond raw indexing

Raw `block.transactions[]` entries are now indexed in `logos_transactions`
whenever the current node emits them. The remaining future work is richer
protocol-aware decoding (notes, commitments, lifecycle tables) once the shape is
stable enough to treat as an explorer contract.

The current explorer API already adds a **safe decode v1** layer: opcode names,
proof kinds, normalized known payload fields, and compact byte previews. This is
intentionally limited and does not claim full semantic decoding of notes,
transfers, or opaque metadata.

Transactions currently look like:

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

**Remaining implementation plan:**
1. Keep raw `logos_transactions` indexing as the source of truth.
2. Add decoded note/commitment tables only after the live payload shape is stable.
3. Re-run or migrate indexer data only if a future network reset changes the canonical schema.

For the full network upgrade workflow, including when to edit `001-schema.sql`
versus creating a new migration file, see [`network-upgrades.md`](network-upgrades.md).

---

## Schema Migrations

For Logos testnet resets with a new genesis, the preferred approach is usually a
fresh database or full truncate/re-index from slot 0. For networks where data
must be preserved, create additive migration files (`initdb/002-*.sql`) instead
of rewriting the already-applied schema.

Recommended procedure for richer transaction support:

1. Stop the indexer.
2. Confirm the new block/transaction JSON shape against a live upgraded node.
3. Add or apply a migration for decoded transaction/note tables.
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

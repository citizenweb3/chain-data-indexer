# Monero Indexer Future Work

This document captures work that is intentionally **out of scope** for the first
production Monero branch.

---

## Wallet balances and address ownership

Not planned in v1.

Reason:

- Monero privacy design does not expose explorer-safe public balances or address ownership.
- Raw transaction structure is insufficient to infer wallet ownership safely.

This branch stores raw blocks and transactions, but does not attempt wallet-level
analytics.

---

## Miner / pool identity modeling

Not planned in v1.

Reason:

- Monero does not expose a stable validator-style identity model.
- Coinbase and extra data are not a safe foundation for explorer-grade miner identity.

If a future product explicitly wants pool heuristics, they should be isolated as
heuristics and never presented as canonical validator entities.

---

## Mempool analytics

Not planned in v1.

Possible later additions:

- mempool size/time series,
- fee histogram snapshots,
- pending transaction explorer views.

These should be implemented only if backed by explicit node RPC behavior and
clear product demand.

---

## Supply self-hosting without RPC

Possible future improvement:

- compute supply directly from indexed canonical block/coinbase data,
- keep `get_coinbase_tx_sum` as audit/rebuild verification only.

This would reduce dependence on a heavy daemon RPC for long historical rebuilds.

# Handoff → validatorinfo dev: Aztec indexer v5 cutover

**From:** indexer team · **Date:** 2026-07-16 · **Scope:** what changes on YOUR side when the
Aztec indexer switches from the v4 rollup to the v5 rollup.

TL;DR: the indexer API is almost entirely frozen — you do **not** need to rewrite your Aztec
integration. There is **one required DB change**, one height-behavior change to be aware of, and
one contract-endpoint shape change you can ignore unless you start reading contract data.

---

## 1. REQUIRED: reset one cursor field at cutover 🔴

You persist a per-chain reward cursor: `Chain.totalRewardsLastBlock`
(`total_rewards_last_block`). `server/tools/chains/aztec/get-total-earned-rewards.ts` reads it as
`lastProcessed` and early-returns when `lastProcessed >= latestHeight`.

The v5 rollup is a **new chain that restarts block height at 0**. After cutover the indexer's
`/l2/latest-height` drops from ~117977 to a small number, while your cursor is stuck at ~84261
(last proven v4 height). Result: `84261 >= <small>` is true, so **reward accrual freezes
permanently** (until v5 climbs past 84261, which at a fresh-chain rate is effectively never).

**Action:** at cutover, set `Chain.totalRewardsLastBlock = NULL` (or `'0'`) for the aztec chain
row(s) (`aztec`, and `aztec-testnet` if applicable). Coordinate timing with us — do it right
after we flip, not before.

This is the **only** durable data change you must make. It is NOT a cache wipe — see §4.

## 2. Be aware: block height goes 117977 → 0 (this is correct, not a bug)

v5 is a different L1 rollup contract, so the indexer treats it as a new chain and serves it from
height 0. Old v4 blocks stay in the indexer DB but **leave the API** (filtered by rollup
version). Implications for your code:

- `getLatestBlock` / `getBlocksStrict` / `/l2/latest-height` will report v5 heights (starting
  low) once we cut over. Your cursor-paginated jobs and the `count-blocks-for-day` binary search
  handle this fine (they read live heights; `count-blocks-for-day` uses `cache: 'no-store'`), as
  long as §1 is done.
- **Historical v4 height queries return empty.** If you request a specific old height (e.g.
  90000) after cutover, you'll get nothing — that height belongs to the retired rollup and is no
  longer served. Your date-keyed aggregates (`ChainAprHistory`, `ChainTxDailySnapshot`) are
  unaffected — old rows stay as the v4 era, new rows reflect v5.
- Expect a visible discontinuity in charts at the cutover (tx totals, block counts drop to the
  v5 baseline). That is the truth of a chain restart, not a regression.

## 3. Contract endpoints: `publicKeys` shape changed (ignore unless you read contracts)

`/l2/contract-instances*` responses changed the `publicKeys` object to match v5:

```
// was (v4): four curve points
{ masterNullifierPublicKey, masterIncomingViewingPublicKey,
  masterOutgoingViewingPublicKey, masterTaggingPublicKey }
// now (v5): one point + five hashes
{ ivpkM,            // curve point (the only one still a point)
  npkMHash, ovpkMHash, tpkMHash, mspkMHash, fbpkMHash }   // Fr hashes
```

We confirmed validatorinfo does **not** read any contract endpoint today, so this is
informational. If you add contract-instance rendering later, use the new field names. For old v4
instances these fields are `null` (they leave the API anyway).

## 4. What did NOT change (so you don't go looking)

- **`finalizationStatus` enum is unchanged.** Your hardcoded `AZTEC_FINALIZED_STATUS_THRESHOLD =
  3` / `status >= 3` in `src/utils/aztec.ts` stays correct — `L2_NODE_SEEN_PROVEN` is still `3`.
  Finalized badge, APR history, TPS, reward attribution: all keep working.
- **Every other `/l2/*` field is byte-frozen** — block header
  (`globalVariables.{timestamp,coinbase,feeRecipient,gasFees,version,slotNumber,chainId}`,
  `totalFees`, `totalManaUsed`, `spongeBlobHash`, `lastArchive`, `state.*`), `archive`,
  `body.txEffects`, tx-effect fields incl. `revertCode.code`, the `/l2/ui/*` table shapes, pending
  /dropped-tx fields, and the stats endpoints. Verified field-by-field against a live v5 block.
- **The API-response caches are Next.js TTL (`unstable_cache` / `revalidate`), which self-expire.**
  Nothing to manually flush — the earlier "reset your Prisma cache" note was wrong; §1 is the only
  DB action.
- **Validator lists** still come from your own L1 event sync (viem → Prisma), untouched by this.

## 5. Coordination checklist (day of cutover)

1. Indexer team flips `CURRENT_ROLLUP_VERSION` to v5 and deploys.
2. Indexer team confirms `/l2/latest-height` now returns v5 heights and climbs.
3. **You** run: `UPDATE "Chain" SET total_rewards_last_block = NULL WHERE name IN ('aztec','aztec-testnet');`
4. Watch one cycle of `update-aztec-total-earned-rewards` — it should log "Processing finalized
   blocks 1 to N" rather than "No new finalized blocks to process".
5. Sanity-check a block/tx render and the finalized badge.

Questions → indexer team. Field-level detail lives in the indexer repo at
`docs/AZTEC_V5_MIGRATION.md`.

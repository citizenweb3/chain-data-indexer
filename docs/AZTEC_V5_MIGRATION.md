# Aztec v5 migration plan (indexer)

Status: **code complete** — S1–S5 done, verified against the live v5 node. S6 (deploy) is the
only remaining step and is GATED on explicit go: it runs prod migrations, drains Kafka, and
rebuilds/restarts prod. Nothing committed yet; nothing applied to prod.
Owner: architecture — implementation delegated per-stage
Target SDK: `@aztec/*` **5.0.0** (stable; upstream chicmoz sits on `5.0.0-rc.2`)
Was: `@aztec/*` **4.1.1**

### Progress log
- **S1 ✅** SDK bumped 4.1.1→5.0.0, lockfile refreshed. 33 compile errors captured (all 3
  predicted + 4 unpredicted, see §3.5).
- **S2 ✅** aztec-listener fixed (getBlock reconstruct, getBlockNumber("proven"), txsLimits,
  fromStringUnsafe). 31 tests pass. Cascade errors vanished on their own — clean fix.
- **S3 ✅** explorer-api contracts on v5. publicKeys reshaped (only sanctioned API change),
  immutablesHash stored-not-exposed, dead private/utility-fn path removed.
- **S3 fixup ✅** migrations made prod-safe: 0011 idempotent (IF EXISTS), 0012 nullable cols.
  Snapshots reconciled.
- **S3.5 ✅** aztec-standards casts unblocked (`as unknown as`), bump deferred. explorer-api now
  compiles with ZERO errors.
- **S4 ✅** rollup-version partitioning. Version flipped to v5_0_0. Audited every /l2/* read
  path — found & fixed several UNfiltered queries (worst: `getLatestTxEffects` had no WHERE at
  all → would have served only stale v4 tx effects). Listener heights table now keyed by
  `(networkId, rollupVersion)`; migration 0004 backfills the existing row with 2934756905.
  Reorg/reconcile paths now version-aware. New test proves the cursor starts at 0 on the new
  version (does not inherit 117975). Both services rebuild clean, 34/34 listener tests pass
  (verified by architect, not just agent). Prod PK name confirmed `heights_pkey` = what 0004 drops.
- **S5 ✅** End-to-end verified against the LIVE v5 node with our real code: 4/4 live blocks
  round-trip listener(reconstruct+toBuffer)→explorer(blockFromBuffer+parseBlock)→zod. Every
  schema field present with correct shape (§3.8). Tx decomposition proven structurally on
  SDK-generated blocks w/ txs+logs (3/3: txHash, private/public/contractClass logs, noteHashes,
  nullifiers) — live on-chain tx re-check pending real v5 transactions.
- **S6 ✅ DEPLOYED 2026-07-16.** DBs backed up, images rebuilt, migrations applied (exit 0:
  listener 0004, explorer-api 0011/0012), services restarted. Listener now polls v5 with ZERO
  `Method not found` errors; a fresh heights row `(MAINNET, 4248422647)` started at 0 and caught
  up to the tip (1534), old `(MAINNET, 2934756905)` row untouched. explorer-api ingesting v5
  blocks (version 4248422647), no parse errors. `/l2/latest-height` → 1535, `/l2/blocks/latest`
  → v5 block with all frozen fields correct (finalizationStatus 0, coinbase, timestamp, hash).
  Kafka topics left intact (§6 step 2 decision). Recovery complete — prod records v5 again.

---

## 0. Executive summary

The Aztec network upgraded to v5. Our indexer (`aztec-listener` + `explorer-api`) still runs
the 4.1.1 SDK and **is already degraded in production**: the node no longer exposes
`getProvenBlockNumber`, so proven-height polling fails against a v5 node.

The good news, established by direct measurement (see §1): **the v5 upgrade does not touch any
data shape we expose.** `L2Block`, `BlockHeader`, `GlobalVariables` and `TxEffect` are
byte-identical between SDK 4.1.1 and 5.0.0. Our REST API is decoupled from SDK types by an
anti-corruption layer (`packages/backend-utils/src/parse-block.ts` → our own zod schemas), so
**the explorer (validatorinfo) needs zero changes.** That is the primary constraint of this plan
and every stage below is written to preserve it.

Three things break in our code, and two operational landmines exist that are *not* code bugs.

---

## 1. Findings (all empirically verified, not inferred)

### 1.1 Live RPC probe (`https://rpc.aztec.citizenweb3.com/`)

The node already reports `nodeVersion: 5.0.0`, `rollupVersion: 4248422647`.

| Call | Result |
|---|---|
| `node_getProvenBlockNumber` | **`Method not found`** — removed, *not* aliased |
| `getBlockNumber("proven"\|"checkpointed"\|"finalized")` | works — positional **string** tag |
| `getBlockNumber({tag:"proven"})` | `Invalid input` — object form rejected |
| `getBlockNumber()` (no args) | works — latest proposed. No `"latest"` tag exists |
| `node_getL2Tips` | `Method not found` → replaced by `getChainTips` (we never called it) |
| `getBlock` | accepts **both** `[0]` and `[{number:0}]` |
| `node_getBlockNumber`, `node_getPendingTxs`, `node_getValidatorsStats`, `node_getPublicStorageAt`, `node_getBlock` | still work via the legacy `node_*` alias |

The `node_*` → `aztec_*` namespace rename is transparent to us (the SDK client builds method
names), and legacy aliases still resolve. **But the migration guide says aliases will be removed
in a future release** — this is a deferral, not an exemption.

### 1.2 SDK type diff (4.1.1 → 5.0.0, `.d.ts` compared directly)

**Unchanged — verified field-identical or byte-identical:**
`L2Block` (constructor + `toBuffer`/`fromBuffer`), `BlockHeader` (`lastArchive`, `state`,
`spongeBlobHash`, `globalVariables`, `totalFees`, `totalManaUsed`), `StateReference`,
`PartialStateReference`, `GlobalVariables` (`chainId`, `version`, `blockNumber`, `slotNumber`,
`timestamp`, `coinbase`, `feeRecipient`, `gasFees`), `GasFees`, `AppendOnlyTreeSnapshot`,
`TxEffect`, `PrivateLog`, `PublicLog`, `ContractClassLog`, `TxHash`, `getPublicStorageAt`,
`deriveStorageSlotInMap`, `BlockNumber()`. All import subpaths still exist in v5's export map.

**Breaking for us — exactly three:**

1. **`getBlock` return shape.** v4 returned an `L2Block` *instance*. v5 returns a plain
   `BlockResponse` object, and `body` (tx effects) is **omitted unless you pass
   `{ includeTransactions: true }`**. `BlockResponse` has no `.toBuffer()`, which
   `events/emitted/index.ts` calls directly. Fix: request `includeTransactions`, then
   reconstruct `new L2Block(archive, header, body, checkpointNumber, indexWithinCheckpoint)`.
   The `L2Block` constructor is unchanged, so everything downstream of the reconstruction
   (including `parse-block.ts`) needs **no** changes.
2. **`getProvenBlockNumber` removed.** → `getBlockNumber("proven")`.
3. **`NodeInfo` gained a required `txsLimits` field.** We hand-build a `NodeInfo` literal in
   `getFreshInfo()`; it will no longer typecheck.

**New but ignorable for the listener:** `getL2Tips`→`getChainTips`, `getBlockHeader` removed
(uncalled), `getValidatorsStats` internal shape drift (we only `JSON.stringify` it for logs),
`getPendingTxs`/`getContract` gained optional params.

**Breaking outside the listener:** `ContractInstance` gained a required **`immutablesHash: Fr`**
(preimage version 1→2), and `ContractClassPublic` dropped `privateFunctions`/`utilityFunctions`.
This hits `services/explorer-api/src/events/received/on-block/contracts.ts`, which calls
`ContractInstancePublishedEvent.fromLog(...).toContractInstance()`.

### 1.3 Upstream (`aztec-scan/chicmoz`) already did this

We forked at 4.1.1; upstream is on v5. Portable prior art:

- **PR #659** (2026-06-18) — the v5 rc.1 migration. Contains the exact `network-client` changes
  above, the `immutablesHash` field, and migration `0035_contract_instance_immutables_hash.sql`.
- **PR #664** (2026-07-01) — bump to `5.0.0-rc.2`; `AztecAddress.fromString` → `fromStringUnsafe`.
- **Commit `8478dbbe`** (2026-07-13) — *critical*: block reconciliation did not filter by rollup
  version, so after a v4→v5 upgrade, old-version blocks counted as "already present" and gaps
  went undetected. This is our exact scenario.

### 1.4 Explorer contract (`citizenweb3/validatorinfo`)

The explorer touches **only `/l2/*`**, through one centralized client
(`src/app/services/aztec-indexer-api/`). Load-bearing response fields:

- `finalizationStatus` — **`src/utils/aztec.ts` hardcodes `>= 3`** to mean "finalized",
  mirroring our `ChicmozL2BlockFinalizationStatus.L2_NODE_SEEN_PROVEN = 3`. Drives the
  finalized badge, APR history, TPS, and reward accounting.
- `height` / `blockHeight` (must stay `Number()`-coercible), `header.globalVariables.*`,
  `header.{totalFees,totalManaUsed,spongeBlobHash,lastArchive,state.*}`, `archive`,
  `body.txEffects`, tx-effect fields incl. `revertCode` **as an object `{code}`**, and the
  `/l2/ui/*` table shapes.
- `header.globalVariables.coinbase` + `finalizationStatus` are cross-referenced against the
  explorer's own L1-synced validator tables to attribute block rewards.

**Validator lists do NOT come from us.** The explorer syncs L1 staking/attester events directly
via viem into its own Prisma DB. Our `/l1/l2-validators*` endpoints (fed by the
`ethereum-listener` service we deleted from this fork) are **confirmed unused — dead code, safe
to leave or remove.**

---

## 2. Invariants (do not violate)

1. **The REST API response shape does not change.** Not one field added, removed, retyped, or
   reordered in `/l2/*`. New v5 concepts (`checkpointNumber`, `indexWithinCheckpoint`,
   `immutablesHash`) stay internal.
2. **`ChicmozL2BlockFinalizationStatus` is frozen.** Do not renumber, reorder, or insert a
   checkpoint stage into the enum — the explorer hardcodes `>= 3`. If checkpoint visibility is
   ever wanted, add a *separate optional field*, never a new enum member below 3.
3. **All `@aztec/*` packages move in lockstep** to the same version. Mixed versions cause
   runtime errors.
4. `parse-block.ts` stays the anti-corruption layer: absorb v5 changes *there*, not in the
   schema.

---

## 3. Operational landmines (not code bugs — plan around them)

### 3.1 The v5 rollup is a NEW chain starting at height 0 🔴

Verified against the production DB and the live node:

| | old rollup (v4) | new rollup (v5) |
|---|---|---|
| `rollupVersion` | **2934756905** | **4248422647** |
| L1 `rollupAddress` | `0xae2001f7e21d5ecabf6234e9fdd1e76f50f74962` | `0x91ff8bbd8ebb07893010d50a48a1609e5ebd8e34` |

**A different L1 rollup contract** ⇒ v5 is not a continuation of the old chain, it is a fresh
chain from genesis. Our DB holds **117,975 blocks** of the old rollup (`L2_NETWORK_ID=MAINNET`,
`l1ChainId=1`); the listener cursor sits at `processedProposed=117975`, `processedProven=84261`.
The new chain currently has **0 blocks** — expected: the upgrade just happened and the sequencer
quorum has not yet formed to start proposing. *This is not a bug; do not "fix" it.*

Two consequences:

- **The listener will silently stall.** `heightsTable` (`services/aztec-listener/src/svcs/database/schema.ts`)
  is keyed by `networkId` only — no `rollupVersion` column. After the switch,
  `chainProposedBlockHeight` = 0 while `processedProposedBlockHeight` still holds 117975,
  so `while (processed < chain)` never iterates. **No error, no log — it just indexes nothing.**
- **Height collisions in `explorer-api`.** v4 block #N and v5 block #N are different blocks.
  Reorg/dedup logic keys on height and must be partitioned by `rollupVersion` (upstream
  `8478dbbe`).

### 3.1b Decision: DO NOT wipe the database ✅ (decided 2026-07-14)

**Why not just delete the old rollup's data — isn't it all on Ethereum anyway?** It is not:

- **Size is not the issue.** The whole `explorer_api` DB is **342 MB**. Deleting saves nothing.
- **L1 only holds it for ~18 days.** Aztec publishes block bodies as EIP-4844 blobs, and Ethereum
  consensus clients prune blobs after ~4096 epochs (~18 days). Our data spans ~4 weeks, so most
  of it is **already past blob retention and is not recoverable from L1**. What survives on L1
  forever is the rollup contract's events (archive root, block number, proposer) — enough to say
  *that* a block existed and who proposed it, not enough to reconstruct tx effects, logs, fees or
  note hashes, i.e. not enough to rebuild what our API actually serves. (The existence of Aztec's
  `blob-sink` component is itself an admission that blobs expire.)
- **Nothing to re-index from.** Nodes wiped their archiver during the v5 migration (LMDB
  auto-wipe), and v5 nodes do not serve the old rollup contract. Deletion is irreversible.
- **Deleting saves no work.** The `rollupVersion` filter is needed regardless (otherwise the
  listener stalls), and the next upgrade (v6) will reproduce this exact situation.
- **Product angle.** validatorinfo attributes block rewards per validator via
  `header.globalVariables.coinbase`. Rewards earned on the old rollup are part of a validator's
  history; wiping erases it.

The codebase already has the intended ritual for a network upgrade:
`services/explorer-api/src/constants/versions.ts` keeps one constant per historical rollup
version and exposes `CURRENT_ROLLUP_VERSION` (today `v4_1_1 = "2934756905"` — exactly what is in
our DB). Block/stats/contract queries filter on it.

So the migration is: **add `v5_0_0 = "4248422647"`, flip `CURRENT_ROLLUP_VERSION`, reset the
listener cursor.** Old v4 blocks stay in the database and simply drop out of API responses,
because they belong to a different rollup. No `TRUNCATE`, no data loss, and reality is
represented correctly.

The caveat: the filter must be applied on **every** read path. It is present in `get-block.ts`,
`l2block/stats.ts` and the contract controllers — it must be audited for `ui/tables.ts`,
tx-effect queries and `/l2/latest-height`. **Any query missing the filter will serve blocks of a
dead chain.**

### 3.1c Downstream: the explorer will see height go 117977 → 0

That is the truth, not a regression. Verified precisely against the validatorinfo repo
(2026-07-16) — the earlier "reset their Prisma cache" framing was WRONG and is corrected here:

- **API-response caching is Next.js `unstable_cache` (TTL), not Prisma.** `endpoints.ts` uses
  `revalidate: 10/60/300` (or `false` for immutable blocks/txs). TTL self-expires — nothing to
  reset.
- **Date-keyed aggregate tables self-heal.** `ChainAprHistory` and `ChainTxDailySnapshot` key on
  `(chainId, date)`; `ChainTxMetrics` is a single recomputed row. A height reset doesn't strand
  them — old rows stay as the v4 era, new rows reflect v5.
- **The ONE real item is a single persisted cursor field**, not a cache:
  `Chain.totalRewardsLastBlock` (col `total_rewards_last_block`). `get-total-earned-rewards.ts`
  reads it as `lastProcessed` and early-returns when `lastProcessed >= latestHeight`. After
  cutover `latestHeight` drops to ~0 while the field is stuck at ~84261 (last proven v4 height),
  so **validator reward accrual freezes** until v5 climbs back past 84261 — effectively never at
  a fresh-chain block rate. `count-blocks-for-day` is fine (live binary search, `cache:
  'no-store'`, no persisted cursor).

**Action for the explorer team (one field, not a wipe):** reset `Chain.totalRewardsLastBlock`
to `0`/`NULL` for the aztec chain at cutover. Coordinate timing with the cutover.

### 3.2 Kafka wire format 🟠

The listener ships blocks as hex of `block.toBuffer()`; `explorer-api` reads them with
`L2Block.fromBuffer()`. The `L2Block` serialization is *unchanged* in v5, so this is lower risk
than feared — **but** the two services must still be deployed together, and topics drained
before the cutover, because a half-upgraded pipeline mixes a v5 producer with a v4 consumer
whose `getBlock` path has already broken.

### 3.3 Legacy alias sunset 🟡

`node_*` aliases work today and will be removed upstream. We are migrating to the real v5
surface now, so this is informational only — but it means "do nothing" is not a viable
long-term option even ignoring the `getProvenBlockNumber` break.

---

## 3.5 S1 outcome — what the compiler actually said (2026-07-14)

SDK bumped 4.1.1 → 5.0.0 (all 15 `@aztec/*` packages have a stable 5.0.0; `yarn install` clean).
**33 compile errors.** All three predicted breaks confirmed (§1.2). Four were *not* predicted:

| Finding | Impact | Stage |
|---|---|---|
| `AztecAddress.fromString` removed → `fromStringUnsafe` | 2 sites (`handle-proven-block-txs.ts`, `verify-payload.ts`). Foreshadowed by upstream PR #664 | S2/S3 |
| **`PublicKeys` fields renamed** — `masterNullifier/IncomingViewing/OutgoingViewing/TaggingPublicKey` gone | 🔴 **Touches the frozen API.** `packages/types/src/aztec/l2Contract.ts:22-26` exposes these exact names | **S3 — needs a decision** |
| `PrivateFunctionBroadcastedEvent` / `UtilityFunctionBroadcastedEvent` no longer exported | ✅ **Non-event.** `l2_private_function` and `l2_utility_function` hold **0 rows** in prod — those endpoints already return empty | S3 |
| `NoirCompiledContract` requires new `aztec_version` field | 6 errors in `utils/standard-contracts.ts` — bundled Noir artifacts need regeneration | **S3.5 (new)** |

11 of the 18 listener errors are **cascade fallout** of the `getProvenBlockNumber` break (the
generic return type widens to a huge union), not independent problems — they should evaporate
once S2 lands. Do not "fix" them individually.

### The one real decision: `publicKeys` — RESOLVED (2026-07-14)

Not a rename — a **semantic change**, confirmed by diffing the `.d.ts`:

| v4 `PublicKeys` | v5 `PublicKeys` |
|---|---|
| `masterNullifierPublicKey`: Point | `npkMHash`: **Fr (hash)** |
| `masterIncomingViewingPublicKey`: Point | `ivpkM`: Point *(only one still a point)* |
| `masterOutgoingViewingPublicKey`: Point | `ovpkMHash`: **Fr (hash)** |
| `masterTaggingPublicKey`: Point | `tpkMHash`: **Fr (hash)** |
| — | `mspkMHash`: Fr *(new — message-signing)* |
| — | `fbpkMHash`: Fr *(new — fallback)* |

The node no longer emits three of the four master keys as curve points — only their digests,
plus two brand-new keys. Our schema (`concatFrPointSchema`) expects points. **There is nothing to
populate the old point fields with for v5 contracts.** Emitting zeros would publish fabricated
data — the one thing an indexer must never do — and a consumer couldn't tell "no key" from "zero
key".

**Decision (owner, 2026-07-14): bring the schema to v5 reality.** Emit the six real fields
(`ivpkM` as a point, the five `*Hash` as Fr). This is a deliberate `/l2/*` schema change, made
safe by two facts established earlier:

- The API is **internal — only validatorinfo consumes it**, and validatorinfo does **not** read
  contract endpoints (§1.4). No external consumer to version for.
- Old-rollup contract instances leave the API anyway when `CURRENT_ROLLUP_VERSION` flips
  (filter already present in `get-contract-instances.ts:162`), so v4 point-shaped keys and v5
  hash-shaped keys never coexist in a single response.

This is the **one** sanctioned exception to invariant §2.1, and it is confined to the
`publicKeys` object on contract-instance responses. Every other `/l2/*` field stays frozen.

## 3.6 S3 outcome + a pre-existing migration landmine (2026-07-15)

S3 done: `explorer-api` compiles against v5 (only the 6 S3.5 `aztec_version` errors remain).
`publicKeys` reshaped to the six real v5 fields, `immutablesHash` stored-but-not-exposed,
dead private/utility-function broadcast path removed (v5 removed the capability; prod had 0 rows).

**But generating the migration surfaced a separate, deploy-blocking problem — verified against
prod:**

The `migrations` container **gates the services** (`docker-compose.indexer.yml:134`,
`service_completed_successfully`). **A failing migration means the whole indexer does not start.**
Two migrations now in the tree would each fail against prod:

- **`0011_groovy_umar.sql` — pre-existing drift, NOT ours.** Traces to commit `34e95b51`, which
  edited `schema.ts` *and* prod but never ran `yarn generate`. Prod **already** has
  `header.sponge_blob_hash`, already has `numeric` fees, and already lacks `content_commitment` /
  `tx_public_call_request`. So the drizzle snapshot lags reality, and this SQL (`ADD COLUMN
  sponge_blob_hash NOT NULL`, `DROP TABLE content_commitment`) would **error on prod** — the
  columns/tables it targets are already in the target state.
- **`0012_noisy_shen.sql` — ours.** Adds the six `publicKeys` columns + `immutablesHash` as
  `NOT NULL` with no default. Prod has **52** `l2_contract_instance_deployed` rows (all with old
  point keys, none with v5 data), so `ADD COLUMN ... NOT NULL` **errors on those 52 rows**.

Both are fixable; neither is hard; both are prod-migration decisions with a small data-loss
angle (the 52 old rows' 4 point keys get dropped in the reshape — dead-chain instances that
leave the API on the rollup-version flip anyway).

**Resolutions (owner, 2026-07-15):**

- **0011 → make it idempotent.** Rewrite every statement with `IF EXISTS` / `IF NOT EXISTS`
  (and `ADD COLUMN IF NOT EXISTS` for `sponge_blob_hash`). On prod it becomes a harmless no-op
  that drizzle records as applied, advancing the snapshot to match reality; a from-scratch DB
  still converges to the correct schema. Fixes the root cause rather than papering over it.
- **0012 → nullable columns.** The six `publicKeys` fields + `immutablesHash` become nullable
  (no `NOT NULL`). Old v4 instances genuinely have no v5-shaped keys → `NULL` is the honest
  value; new v5 instances always populate them; old instances leave the API on the rollup-version
  flip anyway. The zod/DB types must allow null accordingly (do NOT fabricate zero-keys).

⚠️ These make the migrations *safe to run*, which is a precondition for S6. They do not change
the invariant that only `publicKeys` shape changes in the API.

## 3.7 S3.5 decision — aztec-standards artifacts (2026-07-15)

The 6 remaining errors are `NoirCompiledContract` now requiring `aztec_version`, on bundled
artifacts from the **external** package `@defi-wonderland/aztec-standards` (pinned
`4.0.0-devnet.2-patch.1`; registry has `5.0.0-rc.2` but **no stable 5.0.0**). Used only by
`artifacts.ts` / `getContractJson` to identify whether a deployed contract matches a known
standard (Token/NFT/Escrow…). The artifacts are already cast unchecked (`as NoirCompiledContract`,
with a "types not actually checked" comment), and validatorinfo does not read contract endpoints.

**Decision (owner, 2026-07-15): unblock the build, defer the bump.** Use a clean
`as unknown as NoirCompiledContract` cast, keep v4 artifacts, keep the stack on stable 5.0.0.
Standard-contract identification will not match v5-deployed standards until the package is
bumped — accepted, because the feature is explorer-internal and unconsumed. Leave a TODO to bump
to a **stable** 5.0.0 of aztec-standards when it ships (then add the `5.0.0` `ContractStandardVersion`
key). Do NOT pull `5.0.0-rc.2` into the otherwise-stable stack now.

## 3.8 Live v5 node verification + PROD IS CURRENTLY BROKEN (2026-07-16)

Blocks are now flowing on the v5 chain (sequencer quorum formed). Probed the live node
(`rpc.aztec.citizenweb3.com`): proposed height 1514, proven 1504, `rollupVersion 4248422647`
(= our `v5_0_0`), `nodeVersion 5.0.0`, `txsLimits` present with real values.

**Fetched a real v5 block (#1500) and checked every field `chicmozL2BlockSchema` requires — ALL
present with correct shape:** archive, header.lastArchive, spongeBlobHash, state.l1ToL2MessageTree,
state.partial.{noteHash,nullifier,publicData}Tree, totalFees, totalManaUsed, globalVariables.
{version,blockNumber,timestamp,coinbase,feeRecipient,slotNumber,chainId,gasFees.*}. v5 extras
(`checkpointNumber`, `indexWithinCheckpoint`) present and consumed by our L2Block reconstruction.
This closes the §5 "header shape" risk empirically.

⚠️ **The fresh chain has produced only EMPTY blocks so far (0 txEffects in every block scanned).**
Live tx-effect parsing therefore cannot be exercised against real data yet. Mitigation: SDK diff
proved `TxEffect`/`PrivateLog`/`PublicLog`/`ContractClassLog` are byte-identical 4.1.1↔5.0.0, and
we already parse those correctly. Re-verify once the chain has real transactions.

### 🔴 Production is broken RIGHT NOW — not recording anything

Git HEAD is `898afa74` (pre-v5); **all v5 work is uncommitted/undeployed** (46 files in the
working tree). Prod containers run the old 4.1.1 build. The listener logs show it crashing on
**every** poll cycle: `Method not found: node_getProvenBlockNumber` — the exact break we fixed in
S2. Prod has ingested **zero** v5 blocks; stored data is all old-rollup (max height 84268), stale
since the node upgraded ~2026-07-13. Kafka/zookeeper are healthy (the earlier ECONNREFUSED was
transient crash-loop noise).

**Consequence:** the deploy (S6) is no longer just "finishing" — it is a recovery. Every hour
prod serves stale data and records nothing. The finished code fixes exactly this.

## 4. Work stages

Each stage is a self-contained brief for one implementation agent. Stages are ordered by
dependency. **Every stage ends with `yarn build:packages` passing and the API contract intact.**

### S1 — SDK bump to 5.0.0 (mechanical)

Bump every `@aztec/*` dependency from `4.1.1` to `5.0.0` in lockstep: root `package.json`,
`services/aztec-listener`, `services/explorer-api`, `packages/backend-utils`,
`packages/message-registry`, `packages/contract-verification`. Refresh the lockfile.
Expect the build to fail afterwards — S2/S3 fix it. Do not "fix" type errors by casting to
`any` or loosening zod schemas.

*Acceptance:* `yarn install` clean; the only compile errors are the ones enumerated in §1.2.
Report the actual error list back — it is the checklist for S2/S3.

### S2 — `aztec-listener` network client

Files: `services/aztec-listener/src/svcs/poller/network-client/index.ts`, `pool.ts`.

1. `getBlock`: pass `{ includeTransactions: true }`, guard against a missing `body`, and
   reconstruct a real `L2Block` from the `BlockResponse` before returning — so that
   `events/emitted/index.ts` (`.toBuffer()`) and `parse-block.ts` (`b.body.txEffects`) keep
   working untouched. Mirror upstream PR #659.
2. `getLatestProvenHeight`: `callNodeFunction("getProvenBlockNumber")` →
   `callNodeFunction("getBlockNumber", ["proven"])`. **Positional string tag** — the object form
   `{tag:"proven"}` is rejected by the node (verified).
3. `getFreshInfo`: thread the new required `txsLimits` field through from the RPC response into
   the hand-built `NodeInfo` literal.

*Acceptance:* `aztec-listener` compiles; `parse-block.ts` and `events/emitted/index.ts` are
**not** modified.

### S3 — `explorer-api` contract parsing

Files: `services/explorer-api/src/events/received/on-block/contracts.ts`,
`packages/types/src/aztec/l2Contract.ts`, plus a new drizzle migration.

Port upstream's handling of the new required `immutablesHash` on contract instances (upstream
migration `0035_contract_instance_immutables_hash.sql`) and the `ContractClassPublic` drop of
`privateFunctions`/`utilityFunctions`. Apply `AztecAddress.fromString` → `fromStringUnsafe`
(PR #664) where the SDK now demands it.

**Constraint:** `immutablesHash` is stored but **must not be added to any `/l2/*` API response**
(invariant §2.1). Follow the documented migration workflow (build → `yarn generate` → `yarn migrate`).

*Acceptance:* `explorer-api` compiles; migration generated and reviewed; no `/l2/*` response
schema changed.

### S4 — Rollup-version partitioning 🔴 (the one with teeth)

The v5 chain restarts at height 0 on a new rollup contract (§3.1). **No database wipe** (§3.1b).
Four parts:

1. **Flip the version constant.** `services/explorer-api/src/constants/versions.ts`: add
   `export const v5_0_0 = "4248422647";` and point `CURRENT_ROLLUP_VERSION` at it (keep the
   `SANDBOX` branch working).
2. **Audit every read path for the filter.** `eq(l2Block.version, CURRENT_ROLLUP_VERSION)` is
   applied in `get-block.ts`, `l2block/stats.ts` and the `l2contract/*` controllers. Verify —
   and add where missing — in `ui/tables.ts`, the tx-effect controllers, and `/l2/latest-height`.
   Deliver a table of every `/l2/*` query and whether it filters. **A missing filter serves
   blocks from the dead chain.**
3. **`aztec-listener` heights tracker:** add `rollupVersion` to `heightsTable`, key
   processed/chain heights by `(networkId, rollupVersion)`, so a new rollup version starts its
   own cursor at 0 instead of inheriting 117975. Drizzle migration + backfill stamping existing
   rows with `2934756905`.
4. **`explorer-api`:** port upstream `8478dbbe` so reconciliation / gap detection / reorg
   detection filter by `rollupVersion`.

*Acceptance:* a test proving that with a stored v4 cursor at height 117975 and a chain reporting
height 0 on a *new* rollup version, the poller starts indexing from 0 rather than stalling; and
the query-coverage table from part 2. This stage is what stands between us and a silently dead
indexer.

### S5 — API contract freeze (golden test)

Before touching prod, capture golden snapshots of the `/l2/*` responses the explorer actually
consumes (§1.4 gives the exact list), then assert byte-equality after the upgrade. This is the
machine-checkable proof that validatorinfo will not break, and it is cheaper than discovering
a drift in production.

*Acceptance:* a committed test that fails if any load-bearing field changes shape, **especially**
`finalizationStatus` numbering.

### S6 — Deploy runbook (GATED on explicit go — this is the recovery)

Preconditions (all now TRUE): v5 node producing blocks (proposed 1514+, §3.8) ✅; code compiles
and round-trips against the live node ✅; migrations verified prod-safe ✅.

**Migrations that will run** (all reviewed): explorer-api `0011` (idempotent drift reconcile),
`0012` (nullable publicKeys/immutablesHash); aztec-listener `0004` (heights → composite PK,
backfill v4 row with 2934756905, drops `heights_pkey` — name confirmed against prod).

1. **Commit** the working tree (46 files) on branch `aztec`. Nothing is committed yet.
2. **Kafka — do NOT delete topics** (decision 2026-07-16). Original runbook said "drain", but on
   reflection a destructive topic delete is both unnecessary and riskier than leaving them:
   - Every block now self-identifies its rollup version via `header.globalVariables.version`, so
     even a replayed v4 message is stored under v4 (2934756905), never mistaken for v5 — the
     ingestion path is version-aware (S4).
   - Consumer-group offsets are persistent and we did not change any group id, so explorer-api
     resumes from its committed offset — no mass replay.
   - The old listener has been crash-looping on `getProvenBlockNumber`, producing no new v5
     messages, so there is nothing stale to drain.
   Deleting topics would risk consumer-group/offset breakage for no correctness gain. Leave them.
3. **Build** new images for both services (they share the monorepo; build packages first).
4. **Bring up the `migrations` container** — it gates the services (`service_completed_successfully`).
   If it fails, services won't start: check it exited 0 before proceeding. (This is why 0011/0012
   were made idempotent/nullable — a failure here is a full outage.)
5. **Start** `aztec-listener` + `explorer-api` **together**.
6. **Watch** (first ~5 min):
   - listener logs: `getBlockNumber`/`getBlockNumber("proven")` succeed, no "Method not found".
   - a fresh `heights` row appears for `(MAINNET, 4248422647)` starting near 0 and climbing; the
     old `(MAINNET, 2934756905)` row is untouched.
   - `/l2/latest-height` returns a small, climbing v5 height; `/l2/blocks/latest` parses.
   - explorer-api `/metrics` + `/health` green; no zod parse errors in logs.
7. **Tell the validatorinfo dev to reset `Chain.totalRewardsLastBlock`** (see
   `VALIDATORINFO_HANDOFF_v5.md` §1) — do it right after step 6 confirms v5 heights.
8. **Post-deploy watch (§5 deferred item):** once v5 has climbed a few hundred blocks, compare the
   listener cursor to `count(*)` in `l2Block` for version 4248422647. A gap = a real indexing bug
   (not the old-chain artifact) and becomes urgent.

**Rollback:** redeploy the previous (`898afa74`) images. v4 data is never deleted (soft-delete
discipline). The new migrations are additive/idempotent — a rolled-back v4 service ignores the
extra nullable columns and the `(networkId, rollupVersion)` PK is compatible with the old
single-row write pattern only if the old code is version-agnostic; **if rolling back, also revert
migration 0004's PK change** (the old listener writes keyed by networkId alone). Note this before
rolling back.

---

## 5. Resolved / open

**Resolved:**

- *Zero blocks on the v5 chain* — RESOLVED 2026-07-16: quorum formed, blocks now flowing
  (proposed 1514+, proven 1504+). Verified live (§3.8). The earlier zero-block state was the
  expected post-upgrade gap, not an indexer fault.
- *Wipe the DB?* — **No.** Flip `CURRENT_ROLLUP_VERSION`; old data self-hides (§3.1b).
- *Validator endpoints* — `/l1/l2-validators*` confirmed unused by the explorer (it syncs L1
  staking events itself via viem). Dead code; safe to leave. Separate cleanup, out of scope.

**Deferred (decided 2026-07-14):**

- **~28k block discrepancy.** The listener reports `processedProposed = 117975`, but
  `explorer_api` holds only **89,604** blocks — a gap of ~28k. Deliberately **deferred**: it
  concerns the dead chain, which is leaving the API anyway, and it does not block the migration.
  ⚠️ **But watch it on v5.** If the gap is an indexing bug (lost Kafka events, catchup holes)
  rather than an artifact of the old chain, it will reproduce on the new chain — and there it
  *will* matter. Recheck once v5 blocks start flowing: compare the listener cursor against
  `count(*)` in `l2Block` for rollup version 4248422647. A gap there means a real bug, and this
  deferred item becomes urgent.

**Open:**

- **Explorer-side reset (one field).** At cutover the explorer team must reset
  `Chain.totalRewardsLastBlock` to `0`/`NULL` for the aztec chain, else validator reward accrual
  freezes (§3.1c). This is the ONLY durable explorer-side action — not a cache wipe (the earlier
  "reset Prisma cache" claim was wrong; Next.js TTL caches self-expire and date-keyed aggregates
  self-heal). **Coordinate timing with cutover.**
- **v4 history access.** Old blocks remain in the DB but become unreachable through `/l2/*`.
  If browsable v4 history is ever wanted, it needs an API addition — which violates invariant
  §2.1 and must be designed deliberately, not smuggled in during this migration.

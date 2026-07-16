import { getDb as db } from "@chicmoz-pkg/postgres-helper";
import { and, eq, getTableColumns } from "drizzle-orm";
import { L2_NETWORK_ID } from "../../environment.js";
import { heightsTable } from "./schema.js";

// v5 migration (S4 part 3, AZTEC_V5_MIGRATION.md §3.1/§4): the listener
// learns its current rollup version from getNodeInfo() at startup (see
// svcs/poller/index.ts init(), which calls setCurrentRollupVersion before
// ensureInitializedBlockHeights/startPolling run). Every read/write below
// is scoped to (networkId, rollupVersion) so a NEW rollup version always
// gets its own row starting at height 0, instead of silently inheriting a
// stale cursor left by a previous rollup version (the v4 -> v5 cutover:
// old cursor processedProposed=117975, new chain height=0 - without this,
// `while (processed < chain)` never iterates and the listener indexes
// nothing, with no error).
let currentRollupVersion: number | undefined;

export const setCurrentRollupVersion = (rollupVersion: number): void => {
  currentRollupVersion = rollupVersion;
};

// exported for tests only
export const _testOnlyResetCurrentRollupVersion = (): void => {
  currentRollupVersion = undefined;
};

const getCurrentRollupVersion = (): number => {
  if (currentRollupVersion === undefined) {
    throw new Error(
      "FATAL: heights.controller used before setCurrentRollupVersion was called",
    );
  }
  return currentRollupVersion;
};

const currentHeightsRowWhere = () =>
  and(
    eq(heightsTable.networkId, L2_NETWORK_ID),
    eq(heightsTable.rollupVersion, getCurrentRollupVersion()),
  );

export async function storeProcessedProposedBlockHeight(height: number) {
  await db()
    .update(heightsTable)
    .set({ processedProposedBlockHeight: height })
    .where(currentHeightsRowWhere());
}

export async function storeProcessedProvenBlockHeight(height: number) {
  await db()
    .update(heightsTable)
    .set({ processedProvenBlockHeight: height })
    .where(currentHeightsRowWhere());
}

export async function storeChainProposedBlockHeight(height: number) {
  await db()
    .update(heightsTable)
    .set({ chainProposedBlockHeight: height })
    .where(currentHeightsRowWhere());
}

export async function storeChainProvenBlockHeight(height: number) {
  await db()
    .update(heightsTable)
    .set({ chainProvenBlockHeight: height })
    .where(currentHeightsRowWhere());
}

export async function storeBlockHeights({
  processedProposedBlockHeight,
  chainProposedBlockHeight,
  processedProvenBlockHeight,
  chainProvenBlockHeight,
}: {
  processedProposedBlockHeight: number;
  chainProposedBlockHeight: number;
  processedProvenBlockHeight: number;
  chainProvenBlockHeight: number;
}) {
  await db()
    .update(heightsTable)
    .set({
      processedProposedBlockHeight,
      chainProposedBlockHeight,
      processedProvenBlockHeight,
      chainProvenBlockHeight,
    })
    .where(currentHeightsRowWhere());
}

export async function ensureInitializedBlockHeights() {
  await db()
    .insert(heightsTable)
    .values({
      networkId: L2_NETWORK_ID,
      rollupVersion: getCurrentRollupVersion(),
      processedProposedBlockHeight: 0,
      chainProposedBlockHeight: 0,
      processedProvenBlockHeight: 0,
      chainProvenBlockHeight: 0,
    })
    .onConflictDoNothing();
}

export async function getBlockHeights() {
  const result = await db()
    .select(getTableColumns(heightsTable))
    .from(heightsTable)
    .where(currentHeightsRowWhere())
    .limit(1);
  if (result.length === 0) {throw new Error("FATAL: block heights not initialized");}
  return result[0];
}

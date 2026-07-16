// v5 migration (S4 part 3, AZTEC_V5_MIGRATION.md §3.1/§4): proves the core
// guarantee of the rollup-version-aware heights tracker.
//
// Before this stage, `heights` was keyed by networkId alone. Verified
// against prod: the listener cursor sat at processedProposed=117975 for the
// old v4.1.1 rollup (version 2934756905). After the v4 -> v5 cutover, the
// new rollup (version 4248422647) is a brand-new chain starting at height 0
// (a different L1 rollup contract - not a continuation). Without
// partitioning by rollup version, `while (processed < chain)` becomes
// `while (117975 < 0)`, which never iterates - the listener silently
// indexes nothing, with no error or log. This test proves that a NEW
// rollup version gets its own cursor starting at 0, and that the old
// version's row is left untouched (no wipe - AZTEC_V5_MIGRATION.md §3.1b).
//
// This exercises the real heights.controller.ts against a minimal in-memory
// fake of the drizzle query-builder chain it actually uses (select/insert
// with onConflictDoNothing/update, filtered by `and(eq(...), eq(...))`),
// rather than mocking the whole database layer as the other unit tests in
// this suite do - heights.controller.ts itself (not a caller of it) is the
// unit under test here.

import { describe, it, expect, vi, beforeEach } from "vitest";

const OLD_ROLLUP_VERSION = 2934756905; // v4_1_1 (see explorer-api constants/versions.ts)
const NEW_ROLLUP_VERSION = 4248422647; // v5_0_0

type HeightsRow = {
  networkId: string;
  rollupVersion: number;
  processedProposedBlockHeight: number;
  chainProposedBlockHeight: number;
  processedProvenBlockHeight: number;
  chainProvenBlockHeight: number;
};

let rows: HeightsRow[] = [];

type EqClause = { __type: "eq"; column: { name: string }; value: unknown };
type AndClause = { __type: "and"; clauses: Clause[] };
type Clause = EqClause | AndClause;

const matchesClause = (row: HeightsRow, clause: Clause): boolean => {
  if (clause.__type === "and") {
    return clause.clauses.every((c) => matchesClause(row, c));
  }
  return row[clause.column.name as keyof HeightsRow] === clause.value;
};

// Mock only the two `drizzle-orm` free functions heights.controller.ts uses
// to build its WHERE clauses (plus the column-introspection helper), so the
// fake db() below can interpret them without needing a real SQL engine.
// Everything else (schema.ts's use of `sql`, pgTable, bigint, etc.) is left
// untouched via importOriginal.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (column: { name: string }, value: unknown): EqClause => ({
      __type: "eq",
      column,
      value,
    }),
    and: (...clauses: Clause[]): AndClause => ({ __type: "and", clauses }),
    getTableColumns: (table: unknown) => table,
  };
});

vi.mock("@chicmoz-pkg/postgres-helper", () => ({
  getDb: () => ({
    select: (_cols?: unknown) => ({
      from: (_table: unknown) => ({
        where: (clause: Clause) => ({
          limit: (n: number) =>
            Promise.resolve(rows.filter((r) => matchesClause(r, clause)).slice(0, n)),
        }),
      }),
    }),
    insert: (_table: unknown) => ({
      values: (val: HeightsRow) => ({
        onConflictDoNothing: () => {
          const exists = rows.some(
            (r) =>
              r.networkId === val.networkId &&
              r.rollupVersion === val.rollupVersion,
          );
          if (!exists) {
            rows.push({ ...val });
          }
          return Promise.resolve();
        },
      }),
    }),
    update: (_table: unknown) => ({
      set: (patch: Partial<HeightsRow>) => ({
        where: (clause: Clause) => {
          rows = rows.map((r) =>
            matchesClause(r, clause) ? { ...r, ...patch } : r,
          );
          return Promise.resolve();
        },
      }),
    }),
  }),
}));

// Imported after the mocks above (vi.mock is hoisted, but this keeps intent
// obvious): the real, unmodified heights.controller.ts.
import * as heightsController from "../../src/svcs/database/heights.controller.js";

describe("heights.controller rollup-version partitioning (S4)", () => {
  beforeEach(() => {
    rows = [];
    heightsController._testOnlyResetCurrentRollupVersion();
  });

  it("starts a brand-new rollup version's cursor at 0 instead of inheriting the old version's processed height", async () => {
    // Seed exactly the prod scenario: an existing v4.1.1 row deep into its
    // chain.
    rows.push({
      networkId: "SANDBOX",
      rollupVersion: OLD_ROLLUP_VERSION,
      processedProposedBlockHeight: 117975,
      chainProposedBlockHeight: 117977,
      processedProvenBlockHeight: 84261,
      chainProvenBlockHeight: 84261,
    });

    // The listener learns the new rollup version from getNodeInfo() at
    // startup (svcs/poller/index.ts init()) and calls this before touching
    // the heights table.
    heightsController.setCurrentRollupVersion(NEW_ROLLUP_VERSION);

    // ensureInitializedBlockHeights() runs on every startup; for a rollup
    // version seen for the first time it must create a fresh row rather
    // than find/reuse the old one.
    await heightsController.ensureInitializedBlockHeights();

    const newVersionHeights = await heightsController.getBlockHeights();
    expect(newVersionHeights.rollupVersion).toBe(NEW_ROLLUP_VERSION);
    expect(newVersionHeights.processedProposedBlockHeight).toBe(0);
    expect(newVersionHeights.processedProvenBlockHeight).toBe(0);

    // The old row must be left exactly as it was - no wipe (§3.1b).
    const oldRow = rows.find((r) => r.rollupVersion === OLD_ROLLUP_VERSION);
    expect(oldRow).toEqual({
      networkId: "SANDBOX",
      rollupVersion: OLD_ROLLUP_VERSION,
      processedProposedBlockHeight: 117975,
      chainProposedBlockHeight: 117977,
      processedProvenBlockHeight: 84261,
      chainProvenBlockHeight: 84261,
    });

    // This is the exact loop condition from
    // svcs/poller/pollers/block_poller/index.ts recursivePolling():
    //   while (heights.processedProposedBlockHeight < chainProposedBlockHeight)
    // Before this fix, the DB row was shared across rollup versions, so
    // this would have been `117975 < 0` -> false forever: the listener
    // would silently index nothing once the node reported the new chain's
    // (initially empty) height. After this fix it correctly starts at 0,
    // so as soon as the new chain produces its first block the poller
    // resumes indexing.
    const chainProposedBlockHeightOnNewRollup = 1;
    expect(
      newVersionHeights.processedProposedBlockHeight <
        chainProposedBlockHeightOnNewRollup,
    ).toBe(true);

    // ...whereas the OLD bug is reproduced here for contrast: comparing the
    // stale cursor against the new chain's height never indexes anything.
    expect(oldRow!.processedProposedBlockHeight < 0).toBe(false);
  });

  it("keeps independent, non-clobbering cursors when switching between rollup versions", async () => {
    heightsController.setCurrentRollupVersion(OLD_ROLLUP_VERSION);
    await heightsController.ensureInitializedBlockHeights();
    await heightsController.storeBlockHeights({
      processedProposedBlockHeight: 50,
      chainProposedBlockHeight: 50,
      processedProvenBlockHeight: 40,
      chainProvenBlockHeight: 40,
    });

    heightsController.setCurrentRollupVersion(NEW_ROLLUP_VERSION);
    await heightsController.ensureInitializedBlockHeights();
    await heightsController.storeProcessedProposedBlockHeight(3);

    const newHeights = await heightsController.getBlockHeights();
    expect(newHeights.processedProposedBlockHeight).toBe(3);

    // Switch back: the old version's row must reflect what was written to
    // it earlier, unaffected by writes made while the new version was
    // current.
    heightsController.setCurrentRollupVersion(OLD_ROLLUP_VERSION);
    const oldHeights = await heightsController.getBlockHeights();
    expect(oldHeights.processedProposedBlockHeight).toBe(50);

    expect(rows).toHaveLength(2);
  });

  it("throws instead of silently defaulting when used before the rollup version is known", async () => {
    await expect(heightsController.getBlockHeights()).rejects.toThrow(
      /setCurrentRollupVersion/,
    );
  });
});

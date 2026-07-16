import { generateAztecAddressColumn } from "@chicmoz-pkg/backend-utils";
import { HexString } from "@chicmoz-pkg/types";
import { sql } from "drizzle-orm";
import {
  bigint,
  integer,
  pgTable,
  primaryKey,
  varchar,
} from "drizzle-orm/pg-core";

export const generateTimestampColumn = (name: string) =>
  bigint(name, { mode: "number" });

// v5 migration (S4 part 3): heights used to be keyed by networkId alone, so
// a rollup upgrade (a NEW rollup contract, chain restarts at height 0 - see
// AZTEC_V5_MIGRATION.md §3.1) would make the poller inherit the old
// version's cursor (e.g. processedProposed=117975) and compare it against
// the new version's chain height (0), so `while (processed < chain)` would
// never iterate - the listener would silently index nothing. Keying by
// (networkId, rollupVersion) instead means a new rollup version always
// starts its own row/cursor at 0.
// bigint+mode:number (not `integer`): rollup versions (e.g. 4248422647)
// exceed Postgres int4's ~2.1B range, matching l2Block.version in
// explorer-api's schema (generateFrNumberColumn).
export const heightsTable = pgTable(
  "heights",
  {
    networkId: varchar("networkId").notNull(),
    rollupVersion: bigint("rollupVersion", { mode: "number" }).notNull(),
    processedProposedBlockHeight: integer(
      "processedProposedBlockHeight",
    ).notNull(),
    chainProposedBlockHeight: integer("chainProposedBlockHeight").notNull(),
    processedProvenBlockHeight: integer(
      "processedProvenBlockHeight",
    ).notNull(),
    chainProvenBlockHeight: integer("chainProvenBlockHeight").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.networkId, t.rollupVersion] }),
  }),
);

export const txStateValues = [
  "pending",
  "suspected_dropped",
  "dropped",
  "proposed",
  "proven",
] as const;
export type TxState = (typeof txStateValues)[number];

export const txsTable = pgTable("txs_table", {
  txHash: varchar("tx_hash").notNull().$type<HexString>().primaryKey(),
  feePayer: generateAztecAddressColumn("fee_payer").notNull(),
  birthTimestamp: generateTimestampColumn("birth_timestamp")
    .notNull()
    .default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
  txState: varchar("tx_state").notNull().$type<TxState>(),
});

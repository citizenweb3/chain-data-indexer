import { getDb as db } from "@chicmoz-pkg/postgres-helper";
import { ChicmozL2BlockLight } from "@chicmoz-pkg/types";
import { and, desc, eq, isNull } from "drizzle-orm";
import { l2Block } from "../../../database/schema/l2block/index.js";
import { CURRENT_ROLLUP_VERSION } from "../../../../constants/versions.js";
import { BlockQueryOptions, getBlock } from "./get-block.js";

export const getLatestBlock = async (
  options: BlockQueryOptions = {},
): Promise<ChicmozL2BlockLight | null> => {
  return getBlock(-1n, options);
};

const getBlockFilters = (options: BlockQueryOptions) => {
  const { includeOrphaned = false } = options;

  const orphanFilter = includeOrphaned
    ? undefined
    : isNull(l2Block.orphan_timestamp);
  return {
    orphanFilter,
    currentVersion: parseInt(CURRENT_ROLLUP_VERSION),
  };
};

// v5 migration (S4, §3.1b/§3.1c): this used to fall back to "whatever
// rollup version actually has data" when CURRENT_ROLLUP_VERSION had none.
// That fallback is what would have kept /l2/latest-height (and, via it,
// the average-fee/average-block-time stats below) silently serving the
// dead v4 chain's height (~117975) instead of truthfully reflecting the
// new v5 chain starting at 0 - exactly the failure §3.1c documents as
// expected, not a bug ("the explorer will see height go 117977 -> 0.
// That is the truth, not a regression."). Removed: both functions are now
// strictly scoped to CURRENT_ROLLUP_VERSION (or an explicit override via
// options.rollupVersion), matching every other rollup-version-aware read
// path (get-block.ts, chain-info/get.ts, rollup-version-cache.ts).
export const getLatestHeight = async (
  options: BlockQueryOptions = {},
): Promise<bigint | null> => {
  const { orphanFilter, currentVersion } = getBlockFilters(options);

  const latestHeightForCurrentVersion = await db()
    .select({ height: l2Block.height })
    .from(l2Block)
    .where(
      orphanFilter
        ? and(orphanFilter, eq(l2Block.version, currentVersion))
        : eq(l2Block.version, currentVersion),
    )
    .orderBy(desc(l2Block.height))
    .limit(1)
    .execute();

  if (latestHeightForCurrentVersion.length === 0) {
    return null;
  }

  return latestHeightForCurrentVersion[0].height;
};

export const getExistingRollupVersion = async (
  options: BlockQueryOptions = {},
): Promise<number | null> => {
  const { orphanFilter, currentVersion } = getBlockFilters(options);

  const hasCurrentVersion = await db()
    .select({ height: l2Block.height })
    .from(l2Block)
    .where(
      orphanFilter
        ? and(orphanFilter, eq(l2Block.version, currentVersion))
        : eq(l2Block.version, currentVersion),
    )
    .limit(1)
    .execute();

  if (hasCurrentVersion.length === 0) {
    return null;
  }

  return currentVersion;
};

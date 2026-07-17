import { queryEarliestActivity } from '@/queries/address-queries';
import { queryCoverage, type CoverageRow } from '@/queries/coverage-queries';

const toCoverageDto = (row: CoverageRow) => ({
  earliest_height: row.earliest_height.toString(),
  earliest_time: row.earliest_time.toISOString(),
});

export const getCoverage = async () => {
  const coverage = await queryCoverage();
  return coverage ? toCoverageDto(coverage) : null;
};

export const getEarliestActivity = async (address: string) => {
  const [activity, coverage] = await Promise.all([queryEarliestActivity(address), queryCoverage()]);
  if (!coverage) return null;

  return {
    earliest: activity
      ? {
          height: activity.height.toString(),
          tx_index: activity.tx_index,
          tx_hash: activity.tx_hash,
          time: activity.time.toISOString(),
          source: activity.source,
        }
      : null,
    coverage: toCoverageDto(coverage),
  };
};

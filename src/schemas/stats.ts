import { z } from '@/lib/openapi-zod';

import { ChainParam, DirectionEnum } from '@/schemas/common';
import { IbcAggregationFreshnessSchema, IbcCoverageStatusSchema } from '@/schemas/ibc-aggregation';

export const StatsQuerySchema = z.object({
  direction: DirectionEnum.default('both'),
});

export const StatsCombinedQuerySchema = StatsQuerySchema.extend({
  breakdown: z.enum(['chain']).optional(),
});

export type StatsQuery = z.infer<typeof StatsQuerySchema>;
export type StatsCombinedQuery = z.infer<typeof StatsCombinedQuerySchema>;

const WindowCountsSchema = z.object({
  '24h': z.number().int().nonnegative(),
  '7d': z.number().int().nonnegative(),
  '30d': z.number().int().nonnegative(),
});

const WindowAmountsSchema = z.object({
  '24h': z.string(),
  '7d': z.string(),
  '30d': z.string(),
});

const WindowCoverageSchema = z.object({
  '24h': IbcCoverageStatusSchema,
  '7d': IbcCoverageStatusSchema,
  '30d': IbcCoverageStatusSchema,
});

const NativeMetadataSchema = z.object({
  native_denom: z.string(),
  native_symbol: z.string(),
  native_decimals: z.number().int().nonnegative(),
});

const StatsPerChainRowSchema = z
  .object({
    chain: ChainParam,
    transfers_count: WindowCountsSchema,
    volume_atom: WindowAmountsSchema,
    volume_native: WindowAmountsSchema,
    volume_usd: WindowAmountsSchema,
    coverage: WindowCoverageSchema,
  })
  .extend(NativeMetadataSchema.shape);

const StatsBaseDataSchema = z
  .object({
    transfers_count: WindowCountsSchema,
    volume_atom: WindowAmountsSchema,
    volume_usd: WindowAmountsSchema,
    coverage: WindowCoverageSchema,
    as_of: z.iso.datetime(),
  })
  .extend(IbcAggregationFreshnessSchema.shape);

export const StatsCombinedDataSchema = StatsBaseDataSchema.extend({
  per_chain: z.array(StatsPerChainRowSchema).optional(),
});

export const StatsChainDataSchema = StatsBaseDataSchema.extend({
  volume_native: WindowAmountsSchema,
}).extend(NativeMetadataSchema.shape);

export const StatsCombinedResponseSchema = z.object({
  data: StatsCombinedDataSchema,
});

export const StatsChainResponseSchema = z.object({
  data: StatsChainDataSchema,
});

// Kept as a source-compatible schema export while callers migrate to the
// explicit combined/per-chain contracts.
export const StatsDataSchema = StatsCombinedDataSchema;
export const StatsResponseSchema = StatsCombinedResponseSchema;

export type StatsCombinedResponse = z.infer<typeof StatsCombinedResponseSchema>;
export type StatsChainResponse = z.infer<typeof StatsChainResponseSchema>;
export type StatsResponse = StatsCombinedResponse;

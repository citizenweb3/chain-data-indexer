import { z } from '@/lib/openapi-zod';

import { ChainParam, DirectionEnum } from '@/schemas/common';

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

const StatsPerChainRowSchema = z.object({
  chain: ChainParam,
  transfers_count: WindowCountsSchema,
  volume_atom: WindowAmountsSchema,
  volume_usd: WindowAmountsSchema,
});

export const StatsDataSchema = z.object({
  transfers_count: WindowCountsSchema,
  volume_atom: WindowAmountsSchema,
  volume_usd: WindowAmountsSchema,
  as_of: z.string(),
  per_chain: z.array(StatsPerChainRowSchema).optional(),
});

export const StatsResponseSchema = z.object({
  data: StatsDataSchema,
});

export type StatsResponse = z.infer<typeof StatsResponseSchema>;

import { z } from '@/lib/openapi-zod';

import { DirectionEnum, PeriodEnum } from '@/schemas/common';

export const AssetsBreakdownQuerySchema = z.object({
  direction: DirectionEnum.default('both'),
  period: PeriodEnum.default('30d'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
  sort: z.enum(['transfers', 'volume_usd', 'share']).default('volume_usd'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export type AssetsBreakdownQuery = z.infer<typeof AssetsBreakdownQuerySchema>;

export const AssetBreakdownRowSchema = z.object({
  native_denom: z.string(),
  symbol: z.string().nullable(),
  decimals: z.number().int().nonnegative().nullable(),
  display: z.string(),
  transfers_count: z.number().int().nonnegative(),
  amount_native: z.string(),
  amount_usd: z.string(),
});

export type AssetBreakdownRow = z.infer<typeof AssetBreakdownRowSchema>;

export const AssetsBreakdownResponseSchema = z.object({
  data: z.array(AssetBreakdownRowSchema),
  totals: z.object({
    transfers_count: z.number().int().nonnegative(),
    amount_usd: z.string(),
  }),
  page: z.object({
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
  }),
  as_of: z.string(),
});

export type AssetsBreakdownResponse = z.infer<typeof AssetsBreakdownResponseSchema>;

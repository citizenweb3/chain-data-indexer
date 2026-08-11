import { z } from '@/lib/openapi-zod';

import { ChainParam, DirectionEnum, PeriodEnum } from '@/schemas/common';
import { IbcAggregationFreshnessSchema, IbcCoverageStatusSchema } from '@/schemas/ibc-aggregation';

export const ChannelsCombinedSortEnum = z.enum([
  'transfers',
  'volume_atom',
  'volume_usd',
  'last_activity',
]);
export const ChannelsChainSortEnum = z.enum([
  'transfers',
  'volume_atom',
  'volume_native',
  'volume_usd',
  'last_activity',
]);
export const SortOrderEnum = z.enum(['asc', 'desc']);

const makeChannelsQuerySchema = (
  sort: typeof ChannelsCombinedSortEnum | typeof ChannelsChainSortEnum,
) =>
  z.object({
    direction: DirectionEnum.default('both'),
    period: PeriodEnum.default('30d'),
    sort: sort.default('volume_usd'),
    order: SortOrderEnum.default('desc'),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  });

export const ChannelsCombinedQuerySchema = makeChannelsQuerySchema(ChannelsCombinedSortEnum);
export const ChannelsChainQuerySchema = makeChannelsQuerySchema(ChannelsChainSortEnum);

// Compatibility exports retain the combined v1 contract.
export const ChannelsSortEnum = ChannelsCombinedSortEnum;
export const ChannelsQuerySchema = ChannelsCombinedQuerySchema;
export type ChannelsQuery = z.infer<typeof ChannelsQuerySchema>;

const PeriodCountsSchema = z.object({
  '24h': z.number().int().nonnegative(),
  '7d': z.number().int().nonnegative(),
  '30d': z.number().int().nonnegative(),
});

const PeriodAmountsSchema = z.object({
  '24h': z.string(),
  '7d': z.string(),
  '30d': z.string(),
});

const PeriodCoverageSchema = z.object({
  '24h': IbcCoverageStatusSchema,
  '7d': IbcCoverageStatusSchema,
  '30d': IbcCoverageStatusSchema,
});

const ChannelDenomSchema = z.object({
  display: z.string(),
  native_denom: z.string(),
  symbol: z.string().nullable(),
  decimals: z.number().int().nonnegative().nullable(),
  count: z.number().int().nonnegative(),
  amount_native: z.string(),
  amount_usd: z.string(),
  raws: z.array(z.string()),
});

const ChannelBaseDtoSchema = z.object({
  chain: ChainParam,
  channel_id_src: z.string(),
  port_id_src: z.string(),
  channel_id_dst: z.string().nullable(),
  counterparty_chain_id: z.string().nullable(),
  counterparty_chain_name: z.string().nullable(),
  transfers: PeriodCountsSchema,
  volume_atom: PeriodAmountsSchema,
  volume_usd: PeriodAmountsSchema,
  coverage: PeriodCoverageSchema,
  success_rate_30d: z.number().min(0).max(1).nullable(),
  last_activity: z.iso.datetime().nullable(),
  denoms: z.array(ChannelDenomSchema),
});

const NativeMetadataSchema = z.object({
  native_denom: z.string(),
  native_symbol: z.string(),
  native_decimals: z.number().int().nonnegative(),
});

export const ChannelCombinedDtoSchema = ChannelBaseDtoSchema;
export const ChannelChainDtoSchema = ChannelBaseDtoSchema.extend({
  volume_native: PeriodAmountsSchema,
}).extend(NativeMetadataSchema.shape);

// Compatibility aliases retain the combined row type for existing consumers.
export const ChannelDtoSchema = ChannelCombinedDtoSchema;
export type ChannelDto = z.infer<typeof ChannelDtoSchema>;

const ChannelsPageSchema = z.object({
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});

export const ChannelsCombinedResponseSchema = z
  .object({
    data: z.array(ChannelCombinedDtoSchema),
    page: ChannelsPageSchema,
  })
  .extend(IbcAggregationFreshnessSchema.shape);

export const ChannelsChainResponseSchema = z
  .object({
    data: z.array(ChannelChainDtoSchema),
    page: ChannelsPageSchema,
  })
  .extend(IbcAggregationFreshnessSchema.shape);

export const ChannelsResponseSchema = ChannelsCombinedResponseSchema;
export type ChannelsResponse = z.infer<typeof ChannelsResponseSchema>;

import { z } from '@/lib/openapi-zod';

import { DirectionEnum, PeriodEnum } from '@/schemas/common';

export const ChannelsSortEnum = z.enum([
  'transfers',
  'volume_atom',
  'volume_usd',
  'last_activity',
]);
export const SortOrderEnum = z.enum(['asc', 'desc']);

export const ChannelsQuerySchema = z.object({
  direction: DirectionEnum.default('both'),
  period: PeriodEnum.default('30d'),
  sort: ChannelsSortEnum.default('volume_usd'),
  order: SortOrderEnum.default('desc'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

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

export const ChannelDtoSchema = z.object({
  channel_id_src: z.string(),
  port_id_src: z.string(),
  channel_id_dst: z.string().nullable(),
  counterparty_chain_id: z.string().nullable(),
  counterparty_chain_name: z.string().nullable(),
  transfers: PeriodCountsSchema,
  volume_atom: PeriodAmountsSchema,
  volume_usd: PeriodAmountsSchema,
  success_rate_30d: z.number().min(0).max(1).nullable(),
  last_activity: z.string().nullable(),
  denoms: z.array(ChannelDenomSchema),
});

export type ChannelDto = z.infer<typeof ChannelDtoSchema>;

export const ChannelsResponseSchema = z.object({
  data: z.array(ChannelDtoSchema),
  page: z.object({
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
  }),
});

export type ChannelsResponse = z.infer<typeof ChannelsResponseSchema>;

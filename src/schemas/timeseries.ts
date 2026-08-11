import { z } from '@/lib/openapi-zod';

import { ChannelSchema, DirectionEnum, IsoDateCoerceSchema } from '@/schemas/common';
import {
  IbcAggregationFreshnessSchema,
  IbcCoverageQualityEnum,
  IbcPacketCoverageSchema,
} from '@/schemas/ibc-aggregation';

export const TimeseriesCombinedMetricEnum = z.enum(['transfers', 'volume_atom', 'volume_usd']);
export const TimeseriesChainMetricEnum = z.enum([
  'transfers',
  'volume_atom',
  'volume_native',
  'volume_usd',
]);
export type TimeseriesCombinedMetric = z.infer<typeof TimeseriesCombinedMetricEnum>;
export type TimeseriesChainMetric = z.infer<typeof TimeseriesChainMetricEnum>;

export const TimeseriesBucketEnum = z.enum(['hour', 'day']);

const makeTimeseriesQuerySchema = (
  metric: typeof TimeseriesCombinedMetricEnum | typeof TimeseriesChainMetricEnum,
) =>
  z
    .object({
      metric,
      direction: DirectionEnum.default('both'),
      bucket: TimeseriesBucketEnum.default('day'),
      from: IsoDateCoerceSchema.optional(),
      to: IsoDateCoerceSchema.optional(),
      channel_id_src: ChannelSchema.optional(),
    })
    .superRefine((data, ctx) => {
      if (data.from && data.to && data.from.getTime() > data.to.getTime()) {
        ctx.addIssue({
          code: 'custom',
          path: ['from'],
          message: 'from must be <= to',
        });
      }
      if (data.from && data.to) {
        const days = (data.to.getTime() - data.from.getTime()) / 86_400_000;
        if (days > 365) {
          ctx.addIssue({
            code: 'custom',
            path: ['to'],
            message: 'range exceeds 365 days',
          });
        }
      }
    });

export const TimeseriesCombinedQuerySchema = makeTimeseriesQuerySchema(
  TimeseriesCombinedMetricEnum,
);
export const TimeseriesChainQuerySchema = makeTimeseriesQuerySchema(TimeseriesChainMetricEnum);

// Compatibility exports for internal consumers that still accept only the
// combined v1 metric set.
export const TimeseriesMetricEnum = TimeseriesCombinedMetricEnum;
export const TimeseriesQuerySchema = TimeseriesCombinedQuerySchema;
export type TimeseriesMetric = TimeseriesCombinedMetric;

export type TimeseriesCombinedQuery = z.infer<typeof TimeseriesCombinedQuerySchema>;
export type TimeseriesChainQuery = z.infer<typeof TimeseriesChainQuerySchema>;
export type TimeseriesQuery = TimeseriesCombinedQuery;

const TimeseriesPointBaseSchema = z.object({
  date: z.string(),
  value: z.string(),
});

export const TimeseriesPointSchema = z.discriminatedUnion('quality', [
  TimeseriesPointBaseSchema.extend({
    quality: z.literal(IbcCoverageQualityEnum.enum.corrected),
    coverage: IbcPacketCoverageSchema,
  }),
  TimeseriesPointBaseSchema.extend({
    quality: z.literal(IbcCoverageQualityEnum.enum.mixed),
    coverage: z.null(),
  }),
  TimeseriesPointBaseSchema.extend({
    quality: z.literal(IbcCoverageQualityEnum.enum.legacy_unverified),
    coverage: z.null(),
  }),
]);

export const TimeseriesResponseSchema = z
  .object({ data: z.array(TimeseriesPointSchema) })
  .extend(IbcAggregationFreshnessSchema.shape);

export type TimeseriesResponse = z.infer<typeof TimeseriesResponseSchema>;

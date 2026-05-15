import { z } from '@/lib/openapi-zod';

import { ChannelSchema, DirectionEnum, IsoDateCoerceSchema } from '@/schemas/common';

export const TimeseriesMetricEnum = z.enum(['transfers', 'volume_atom', 'volume_usd']);
export type TimeseriesMetric = z.infer<typeof TimeseriesMetricEnum>;

export const TimeseriesBucketEnum = z.enum(['day']);

export const TimeseriesQuerySchema = z
  .object({
    metric: TimeseriesMetricEnum,
    direction: DirectionEnum.default('both'),
    bucket: TimeseriesBucketEnum.default('day'),
    from: IsoDateCoerceSchema.optional(),
    to: IsoDateCoerceSchema.optional(),
    channel_id_src: ChannelSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.from && data.to && data.from.getTime() > data.to.getTime()) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: 'from must be <= to' });
    }
    if (data.from && data.to) {
      const days = (data.to.getTime() - data.from.getTime()) / 86_400_000;
      if (days > 365) {
        ctx.addIssue({ code: 'custom', path: ['to'], message: 'range exceeds 365 days' });
      }
    }
  });

export type TimeseriesQuery = z.infer<typeof TimeseriesQuerySchema>;

export const TimeseriesPointSchema = z.object({
  date: z.string(),
  value: z.string(),
});

export const TimeseriesResponseSchema = z.object({
  data: z.array(TimeseriesPointSchema),
});

export type TimeseriesResponse = z.infer<typeof TimeseriesResponseSchema>;

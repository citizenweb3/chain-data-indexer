import { z } from '@/lib/openapi-zod';

import { ChainParam, IsoDateStringSchema } from '@/schemas/common';

export const IbcCoverageQualityEnum = z.enum(['corrected', 'mixed', 'legacy_unverified']);

export const IbcPacketCoverageSchema = z.object({
  eligible_packets: z.number().int().nonnegative(),
  priced_packets: z.number().int().nonnegative(),
  unpriced_packets: z.number().int().nonnegative(),
  unpriced_denoms: z.array(z.string()),
});

const CorrectedCoverageStatusSchema = z.object({
  quality: z.literal('corrected'),
  coverage: IbcPacketCoverageSchema,
});

const MixedCoverageStatusSchema = z.object({
  quality: z.literal('mixed'),
  coverage: z.null(),
});

const LegacyCoverageStatusSchema = z.object({
  quality: z.literal('legacy_unverified'),
  coverage: z.null(),
});

export const IbcCoverageStatusSchema = z.discriminatedUnion('quality', [
  CorrectedCoverageStatusSchema,
  MixedCoverageStatusSchema,
  LegacyCoverageStatusSchema,
]);

export const IbcSourceFreshnessSchema = z.object({
  chain: ChainParam,
  corrected_from: IsoDateStringSchema.nullable(),
  last_successful_sync_at: z.iso.datetime().nullable(),
  last_recomputed_at: z.iso.datetime().nullable(),
  latest_source_event_at: z.iso.datetime().nullable(),
});

export const IbcAggregationFreshnessSchema = z.object({
  generated_at: z.iso.datetime(),
  sources: z.array(IbcSourceFreshnessSchema),
});

export type IbcCoverageQuality = z.infer<typeof IbcCoverageQualityEnum>;
export type IbcPacketCoverage = z.infer<typeof IbcPacketCoverageSchema>;
export type IbcCoverageStatus = z.infer<typeof IbcCoverageStatusSchema>;
export type IbcSourceFreshness = z.infer<typeof IbcSourceFreshnessSchema>;
export type IbcAggregationFreshness = z.infer<typeof IbcAggregationFreshnessSchema>;

import { z } from 'zod';

export const BlockSummarySchema = z.object({
  block_hash: z.string(),
  height: z.string(),
  time: z.string().datetime(),
  tx_count: z.number().int(),
  proposer_address: z.string(),
});

export const BlockDetailSchema = BlockSummarySchema.extend({
  size_bytes: z.number().int().nullable(),
  last_commit_hash: z.string().nullable(),
  data_hash: z.string().nullable(),
  app_hash: z.string().nullable(),
  evidence_count: z.number().int(),
});

export const BlocksListResponseSchema = z.object({
  data: z.array(BlockSummarySchema),
  cursor: z.object({ next_before_height: z.string() }).nullable(),
  has_more: z.boolean(),
  total: z.string(),
});

export const BlockDetailResponseSchema = z.object({
  data: BlockDetailSchema,
});

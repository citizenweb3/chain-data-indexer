import { z } from 'zod';

import { BigIntStringSchema } from '@/schemas/pagination';

const PortSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9._/\-+#:]+$/);

const ChannelSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^channel-\d+$/);

export const IbcTransfersQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    before_height: BigIntStringSchema.optional(),
    before_sequence: BigIntStringSchema.optional(),
    before_channel: ChannelSchema.optional(),
    before_port: PortSchema.optional(),
  })
  .superRefine((data, ctx) => {
    const fields = {
      before_height: data.before_height !== undefined,
      before_sequence: data.before_sequence !== undefined,
      before_channel: data.before_channel !== undefined,
      before_port: data.before_port !== undefined,
    };
    const anyPresent = Object.values(fields).some(Boolean);
    const allPresent = Object.values(fields).every(Boolean);
    if (anyPresent && !allPresent) {
      for (const [key, present] of Object.entries(fields)) {
        if (!present) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message:
              'before_height, before_sequence, before_channel, before_port must be provided together',
          });
        }
      }
    }
  });

export const IbcTransferParamSchema = z.object({
  port: PortSchema,
  channel: ChannelSchema,
  sequence: BigIntStringSchema,
});

import { z } from 'zod';

export const BlocksQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before_height: z
    .string()
    .max(20)
    .regex(/^\d+$/)
    .transform((s) => BigInt(s))
    .optional(),
});

export const TxsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before_height: z
    .string()
    .max(20)
    .regex(/^\d+$/)
    .transform((s) => BigInt(s))
    .optional(),
  before_index: z.coerce.number().int().min(0).optional(),
});

export const HeightParamSchema = z.object({
  h: z
    .string()
    .max(20)
    .regex(/^\d+$/)
    .transform((s) => BigInt(s)),
});

export const HashParamSchema = z.object({
  hash: z
    .string()
    .length(64)
    .regex(/^[A-Fa-f0-9]{64}$/)
    .transform((h) => h.toUpperCase()),
});

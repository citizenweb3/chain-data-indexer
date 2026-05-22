import { z } from '@/lib/openapi-zod';

import { CHAIN_NAMES } from '@/lib/chains';

export const ChainParam = z.enum(CHAIN_NAMES).openapi({
  description: 'Chain slug — one of the registered chains in the chains table.',
  example: 'cosmoshub',
});

export const DirectionEnum = z.enum(['outgoing', 'incoming', 'both']);
export type Direction = z.infer<typeof DirectionEnum>;

export const PacketDirectionEnum = z.enum(['outgoing', 'incoming']);
export type PacketDirection = z.infer<typeof PacketDirectionEnum>;

export const PeriodEnum = z.enum(['24h', '7d', '30d']);
export type Period = z.infer<typeof PeriodEnum>;

export const PacketStatusEnum = z.enum(['sent', 'received', 'acknowledged', 'timeout', 'failed']);
export type PacketStatus = z.infer<typeof PacketStatusEnum>;

export const PortSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9._/\-+#:]+$/);

export const ChannelSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^channel-\d+$/);

export const BigIntStringSchema = z
  .string()
  .max(20)
  .regex(/^\d+$/)
  .transform((s) => BigInt(s));

export const IsoDateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) => {
      const d = new Date(`${s}T00:00:00Z`);
      return Number.isFinite(d.getTime()) && d.toISOString().startsWith(s);
    },
    { message: 'invalid calendar date' },
  );

export const IsoDateCoerceSchema = IsoDateStringSchema.transform((s) => new Date(`${s}T00:00:00Z`));

export const DenomSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9./_-]+$/);

export const ErrorResponseSchema = z.object({
  error: z.enum(['invalid_params', 'not_found', 'internal_error']),
  details: z.unknown().optional(),
});

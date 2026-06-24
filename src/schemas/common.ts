import { z } from 'zod';

export const ErrorResponseSchema = z.object({
  error: z.enum(['invalid_params', 'unauthorized', 'not_found', 'internal_error']),
  details: z.unknown().optional(),
});

// bech32 account address (e.g. atone1...). The data part uses the bech32 charset which
// excludes 1, b, i, o. Length-bounded to avoid alloc/DoS on free text.
export const Bech32AddressSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[a-z0-9]+1[02-9ac-hj-np-z]{6,}$/);

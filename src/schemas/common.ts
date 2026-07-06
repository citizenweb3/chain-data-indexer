import { z } from 'zod';

export const ErrorResponseSchema = z.object({
  error: z.enum(['invalid_params', 'unauthorized', 'not_found', 'internal_error']),
  details: z.unknown().optional(),
});

// bech32 account address (e.g. cosmos1...). The data part uses the bech32 charset which
// excludes 1, b, i, o. Length-bounded to avoid alloc/DoS on free text.
export const Bech32AddressSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[a-z0-9]+1[02-9ac-hj-np-z]{6,}$/);

// bech32 validator operator address (e.g. cosmosvaloper1..., atonevaloper1...).
// Keep this prefix-agnostic for Cosmos SDK chains, but reject account addresses early.
export const ValoperAddressSchema = Bech32AddressSchema.refine(
  (address) => {
    const separator = address.lastIndexOf('1');
    return separator > 0 && address.slice(0, separator).endsWith('valoper');
  },
  { message: 'Expected a validator operator bech32 address' },
);

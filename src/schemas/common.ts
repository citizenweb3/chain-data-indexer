import { z } from 'zod';

import { CHAIN_ACCOUNT_PREFIX } from '@/chain-config';
import { isAccountBech32Address } from '@/lib/cosmos-address';

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

// Account-only endpoints must reject valoper/valcons addresses and malformed checksums before
// services derive related address forms. The generic schema above intentionally remains
// prefix-agnostic because transaction feeds also accept operator addresses.
export const AccountAddressSchema = Bech32AddressSchema.refine(
  (address) => isAccountBech32Address(address, CHAIN_ACCOUNT_PREFIX),
  {
    message: 'Expected an account bech32 address with a valid checksum',
  },
);

// bech32 validator operator address (e.g. cosmosvaloper1..., atonevaloper1...).
// Keep this prefix-agnostic for Cosmos SDK chains, but reject account addresses early.
export const ValoperAddressSchema = Bech32AddressSchema.refine(
  (address) => {
    const separator = address.lastIndexOf('1');
    return separator > 0 && address.slice(0, separator).endsWith('valoper');
  },
  { message: 'Expected a validator operator bech32 address' },
);

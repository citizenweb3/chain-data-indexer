import { z } from 'zod';

import { Bech32AddressSchema } from '@/schemas/common';
import { BigIntStringSchema } from '@/schemas/pagination';

const DenomSchema = z
  .string()
  .min(2)
  .max(128)
  .regex(/^[a-zA-Z][a-zA-Z0-9\/:._-]{1,127}$/, 'Expected a bounded token denomination');

const TxHashSchema = z
  .string()
  .length(64)
  .regex(/^[A-Fa-f0-9]{64}$/)
  .transform((hash) => hash.toUpperCase());

const CURSOR_FIELDS = [
  'before_height',
  'before_tx_hash',
  'before_msg_index',
  'before_from',
  'before_to',
  'before_denom',
] as const;

// Query for GET /api/v1/bank/transfers — the address-scoped transfer feed. The cursor mirrors the
// table's full primary key so keyset pagination stays exact even when one message emits several
// coin rows; all six cursor fields must be provided together or not at all.
export const TransfersByAddressQuerySchema = z
  .object({
    address: z
      .string()
      .transform((value) => value.split(',').map((item) => item.trim()).filter(Boolean))
      .pipe(z.array(Bech32AddressSchema).min(1).max(5)),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    before_height: BigIntStringSchema.optional(),
    before_tx_hash: TxHashSchema.optional(),
    before_msg_index: z.coerce.number().int().min(0).optional(),
    before_from: Bech32AddressSchema.optional(),
    before_to: Bech32AddressSchema.optional(),
    before_denom: DenomSchema.optional(),
  })
  .superRefine((data, context) => {
    const provided = CURSOR_FIELDS.filter((field) => data[field] !== undefined);
    if (provided.length !== 0 && provided.length !== CURSOR_FIELDS.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'all before_* cursor fields must be provided together',
        path: ['before_height'],
      });
    }
  });

export type TransfersByAddressQuery = z.infer<typeof TransfersByAddressQuerySchema>;

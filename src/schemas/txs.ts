import { z } from 'zod';

import { Bech32AddressSchema } from '@/schemas/common';
import { BigIntStringSchema } from '@/schemas/pagination';

// Query for GET /api/v1/txs/by-address — txs the address(es) are involved in (signers grab-bag).
// `address` is a comma-separated list of 1..5 bech32 addresses (e.g. an account + its operator
// for the validator page). trim+filter tolerates spaces and a trailing comma. Cursor is atomic:
// before_height and before_index must be provided together or not at all.
export const TxsByAddressQuerySchema = z
  .object({
    address: z
      .string()
      .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
      .pipe(z.array(Bech32AddressSchema).min(1).max(5)),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    before_height: BigIntStringSchema.optional(),
    before_index: z.coerce.number().int().min(0).optional(),
  })
  .refine((d) => (d.before_height === undefined) === (d.before_index === undefined), {
    message: 'before_height and before_index must be provided together',
    path: ['before_height'],
  });

export const TxSummarySchema = z.object({
  tx_hash: z.string(),
  height: z.string(),
  tx_index: z.number().int(),
  time: z.string().datetime(),
  code: z.number().int(),
  first_msg_type: z.string().nullable(),
  fee: z
    .object({
      amount: z.string().nullable(),
      denom: z.string().nullable(),
    })
    .nullable(),
});

const FeeSchema = z.object({
  amount: z.array(z.object({ amount: z.string(), denom: z.string() })),
  gas_limit: z.string(),
  payer: z.string(),
  granter: z.string(),
});

const MessageSchema = z.object({
  msg_index: z.number().int(),
  type_url: z.string(),
  value: z.record(z.unknown()),
  signer: z.string().nullable(),
});

const EventSchema = z.object({
  msg_index: z.number().int(),
  event_index: z.number().int(),
  event_type: z.string(),
  attributes: z.unknown(),
});

export const TxDetailSchema = z.object({
  tx_hash: z.string(),
  height: z.string(),
  tx_index: z.number().int(),
  time: z.string().datetime(),
  code: z.number().int(),
  gas_wanted: z.string().nullable(),
  gas_used: z.string().nullable(),
  fee: FeeSchema.nullable(),
  memo: z.string().nullable(),
  signers: z.array(z.string()).nullable(),
  log_summary: z.string().nullable(),
  messages: z.array(MessageSchema),
  events: z.array(EventSchema),
});

export const TxsListResponseSchema = z.object({
  data: z.array(TxSummarySchema),
  cursor: z
    .object({
      next_before_height: z.string(),
      next_before_index: z.number().int(),
    })
    .nullable(),
  has_more: z.boolean(),
  total: z.string(),
});

export const TxDetailResponseSchema = z.object({
  data: TxDetailSchema,
});

export const TxRawResponseSchema = z.object({
  data: z.object({
    raw_tx: z.unknown(),
  }),
});

import { z } from 'zod';

import { Bech32AddressSchema } from '@/schemas/common';
import { BigIntStringSchema } from '@/schemas/pagination';

const MessageTypeSchema = z
  .string()
  .regex(/^\/[A-Za-z0-9._]{1,200}$/, 'Expected a Cosmos SDK message type URL');

const AmountStringSchema = z.string().max(80).regex(/^\d+$/, 'Expected an unsigned base-unit amount');

const AmountDenomSchema = z
  .string()
  .min(2)
  .max(128)
  .regex(/^[a-zA-Z][a-zA-Z0-9\/:._-]{1,127}$/, 'Expected a bounded token denomination');

const compareUnsignedDecimalStrings = (left: string, right: string): number => {
  const normalizedLeft = left.replace(/^0+(?=\d)/, '');
  const normalizedRight = right.replace(/^0+(?=\d)/, '');
  if (normalizedLeft.length !== normalizedRight.length) {
    return normalizedLeft.length - normalizedRight.length;
  }
  return normalizedLeft.localeCompare(normalizedRight);
};

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
    msg_type: z
      .string()
      .transform((value) => value.split(',').map((item) => item.trim()).filter(Boolean))
      .pipe(z.array(MessageTypeSchema).min(1).max(5))
      .optional(),
    from_time: z.string().datetime({ offset: true }).optional(),
    to_time: z.string().datetime({ offset: true }).optional(),
    min_amount: AmountStringSchema.optional(),
    max_amount: AmountStringSchema.optional(),
    amount_denom: AmountDenomSchema.optional(),
    // Opt out of the exact COUNT(*) total. Cursor-paginated clients (ValidatorInfo) never read
    // `total`, and the COUNT over a large `signers &&` match set (e.g. a top validator's valoper,
    // ~1.7M rows) costs 10–20s. Default 'true' preserves the envelope contract for other consumers.
    count: z.enum(['true', 'false']).default('true'),
  })
  .superRefine((data, context) => {
    if ((data.before_height === undefined) !== (data.before_index === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'before_height and before_index must be provided together',
        path: ['before_height'],
      });
    }

    if (
      data.from_time !== undefined &&
      data.to_time !== undefined &&
      Date.parse(data.from_time) > Date.parse(data.to_time)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'from_time must be before or equal to to_time',
        path: ['from_time'],
      });
    }

    const hasAmountBound = data.min_amount !== undefined || data.max_amount !== undefined;
    if (hasAmountBound !== (data.amount_denom !== undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'amount_denom and at least one amount bound must be provided together',
        path: ['amount_denom'],
      });
    }

    if (
      data.min_amount !== undefined &&
      data.max_amount !== undefined &&
      compareUnsignedDecimalStrings(data.min_amount, data.max_amount) > 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'min_amount must be less than or equal to max_amount',
        path: ['min_amount'],
      });
    }
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

export const TxTransferSchema = z.object({
  from_addr: z.string(),
  to_addr: z.string(),
  denom: z.string(),
  amount: z.string(),
});

export const TxByAddressSummarySchema = TxSummarySchema.extend({
  transfers: z.array(TxTransferSchema),
  msg_types: z.array(MessageTypeSchema),
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

export const TxsByAddressListResponseSchema = TxsListResponseSchema.extend({
  data: z.array(TxByAddressSummarySchema),
});

export const TxDetailResponseSchema = z.object({
  data: TxDetailSchema,
});

export const TxRawResponseSchema = z.object({
  data: z.object({
    raw_tx: z.unknown(),
  }),
});

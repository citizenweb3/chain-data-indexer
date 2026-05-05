import { z } from 'zod';

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

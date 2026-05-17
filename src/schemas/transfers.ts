import { z } from '@/lib/openapi-zod';

import {
  BigIntStringSchema,
  ChannelSchema,
  DenomSchema,
  PacketDirectionEnum,
  PacketStatusEnum,
  PortSchema,
} from '@/schemas/common';

export const TransferFilterDirectionEnum = z.enum(['outgoing', 'incoming', 'both']);

export const TransfersListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    before_height: BigIntStringSchema.optional(),
    before_sequence: BigIntStringSchema.optional(),
    before_channel: ChannelSchema.optional(),
    before_port: PortSchema.optional(),
    channel_id_src: ChannelSchema.optional(),
    direction: TransferFilterDirectionEnum.default('both'),
    status: PacketStatusEnum.optional(),
    denom: DenomSchema.optional(),
    denom_base: DenomSchema.optional(),
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
            code: 'custom',
            path: [key],
            message:
              'before_height, before_sequence, before_channel, before_port must be provided together',
          });
        }
      }
    }
    if (data.denom !== undefined && data.denom_base !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['denom_base'],
        message: 'denom and denom_base are mutually exclusive',
      });
    }
  });

export type TransfersListQuery = z.infer<typeof TransfersListQuerySchema>;

export const TransferParamSchema = z.object({
  port: PortSchema,
  channel: ChannelSchema,
  sequence: BigIntStringSchema,
});

export type TransferParam = z.infer<typeof TransferParamSchema>;

export const IbcTransferDtoSchema = z.object({
  port_id_src: z.string(),
  channel_id_src: z.string(),
  sequence: z.string(),
  port_id_dst: z.string().nullable(),
  channel_id_dst: z.string().nullable(),
  status: PacketStatusEnum,
  direction: PacketDirectionEnum,
  event_height: z.string().nullable(),
  event_time: z.string().nullable(),
  tx_hash_send: z.string().nullable(),
  height_send: z.string().nullable(),
  tx_hash_recv: z.string().nullable(),
  height_recv: z.string().nullable(),
  tx_hash_ack: z.string().nullable(),
  height_ack: z.string().nullable(),
  denom: z.string().nullable(),
  amount: z.string().nullable(),
  memo: z.string().nullable(),
  relayer: z.string().nullable(),
  timeout_height: z.string().nullable(),
  timeout_ts: z.string().nullable(),
  base_denom: z.string().nullable(),
  asset_symbol: z.string().nullable(),
  asset_decimals: z.number().int().nullable(),
});

export type IbcTransferDto = z.infer<typeof IbcTransferDtoSchema>;

export const IbcTransfersCursorSchema = z.object({
  next_before_height: z.string(),
  next_before_sequence: z.string(),
  next_before_channel: z.string(),
  next_before_port: z.string(),
});

export type IbcTransfersCursor = z.infer<typeof IbcTransfersCursorSchema>;

export const TransfersListResponseSchema = z.object({
  data: z.array(IbcTransferDtoSchema),
  cursor: IbcTransfersCursorSchema.nullable(),
  has_more: z.boolean(),
  total: z.string(),
});

export type TransfersListResponse = z.infer<typeof TransfersListResponseSchema>;

export const TransferDetailResponseSchema = z.object({
  data: IbcTransferDtoSchema.extend({
    amount_usd: z.string().nullable(),
    synced_at: z.string().nullable(),
  }),
});

export type TransferDetailResponse = z.infer<typeof TransferDetailResponseSchema>;

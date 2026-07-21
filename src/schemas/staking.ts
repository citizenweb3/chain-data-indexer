import { z } from 'zod';

import { AccountAddressSchema, ValoperAddressSchema } from '@/schemas/common';
import { BigIntStringSchema } from '@/schemas/pagination';

// Kept as a digit string: the driver types BigInt params as int8, which caps at 19 digits,
// while amount is NUMERIC(80,0). The query casts the text explicitly.
const DelegationAmountCursorSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^\d+$/);

export const DelegationsQuerySchema = z
  .object({
    validator: ValoperAddressSchema,
    limit: z.coerce.number().int().min(1).max(100).default(20),
    sort: z.enum(['time', 'amount']).default('time'),
    order: z.enum(['asc', 'desc']).default('desc'),
    before_amount: DelegationAmountCursorSchema.optional(),
    before_height: BigIntStringSchema.optional(),
    before_index: z.coerce.number().int().min(0).optional(),
    before_msg_index: z.coerce.number().int().min(-1).optional(),
  })
  .superRefine((data, context) => {
    const timeCursorFields = [data.before_height, data.before_index, data.before_msg_index];
    const timeCursorFieldCount = timeCursorFields.filter((value) => value !== undefined).length;

    if (data.sort === 'time') {
      if (data.before_amount !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'before_amount is only valid when sort=amount',
          path: ['before_amount'],
        });
      }

      if (timeCursorFieldCount !== 0 && timeCursorFieldCount !== timeCursorFields.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'before_height, before_index, and before_msg_index must be provided together',
          path: ['before_height'],
        });
      }
      return;
    }

    const amountCursorFields = [data.before_amount, ...timeCursorFields];
    const amountCursorFieldCount = amountCursorFields.filter((value) => value !== undefined).length;
    if (amountCursorFieldCount !== 0 && amountCursorFieldCount !== amountCursorFields.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'before_amount, before_height, before_index, and before_msg_index must be provided together',
        path: ['before_amount'],
      });
    }
  });

export const StakingDeltasQuerySchema = z
  .object({
    delegator: AccountAddressSchema,
    limit: z.coerce.number().int().min(1).max(100).default(100),
    before_height: BigIntStringSchema.optional(),
    before_index: z.coerce.number().int().min(0).optional(),
    before_msg_index: z.coerce.number().int().min(-1).optional(),
  })
  .refine(
    (data) => {
      const cursorFields = [data.before_height, data.before_index, data.before_msg_index];
      const present = cursorFields.filter((value) => value !== undefined).length;
      return present === 0 || present === cursorFields.length;
    },
    {
      message: 'before_height, before_index, and before_msg_index must be provided together',
      path: ['before_height'],
    },
  );

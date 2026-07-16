import { z } from 'zod';

import { AccountAddressSchema, ValoperAddressSchema } from '@/schemas/common';
import { BigIntStringSchema } from '@/schemas/pagination';

export const DelegationsQuerySchema = z
  .object({
    validator: ValoperAddressSchema,
    limit: z.coerce.number().int().min(1).max(100).default(20),
    before_height: BigIntStringSchema.optional(),
    before_index: z.coerce.number().int().min(0).optional(),
    before_msg_index: z.coerce.number().int().min(-1).optional(),
  })
  .refine(
    (d) =>
      (d.before_height === undefined) === (d.before_index === undefined) &&
      (d.before_height === undefined) === (d.before_msg_index === undefined),
    {
      message: 'before_height, before_index, and before_msg_index must be provided together',
      path: ['before_height'],
    },
  );

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

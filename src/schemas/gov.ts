import { z } from 'zod';

import { Bech32AddressSchema } from '@/schemas/common';
import { BigIntStringSchema } from '@/schemas/pagination';

export const GovVotesQuerySchema = z.object({
  voter: Bech32AddressSchema,
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before_proposal_id: BigIntStringSchema.optional(),
});

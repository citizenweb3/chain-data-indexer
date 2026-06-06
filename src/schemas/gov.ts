import { z } from 'zod';

import { BigIntStringSchema } from '@/schemas/pagination';

// Voter is a bech32 account address (e.g. cosmos1...). The data part uses the bech32
// charset which excludes 1, b, i, o. Length-bounded to avoid alloc/DoS on free text.
const VoterSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[a-z0-9]+1[02-9ac-hj-np-z]{6,}$/);

export const GovVotesQuerySchema = z.object({
  voter: VoterSchema,
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before_proposal_id: BigIntStringSchema.optional(),
});

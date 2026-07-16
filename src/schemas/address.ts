import { z } from 'zod';

import { AccountAddressSchema } from '@/schemas/common';

export const EarliestActivityQuerySchema = z.object({
  address: AccountAddressSchema,
});

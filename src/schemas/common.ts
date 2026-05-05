import { z } from 'zod';

export const ErrorResponseSchema = z.object({
  error: z.enum(['invalid_params', 'unauthorized', 'not_found', 'internal_error']),
  details: z.unknown().optional(),
});

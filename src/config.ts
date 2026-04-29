import { z } from 'zod';
import 'dotenv/config';

const ConfigSchema = z.object({
  NODE_URL: z.string().url().default('http://127.0.0.1:57291'),
  DATABASE_URL: z.string().url().optional(),
  PG_HOST: z.string().default('localhost'),
  PG_PORT: z.coerce.number().int().positive().default(5432),
  PG_DB: z.string().default('miden_indexer'),
  PG_USER: z.string().default('miden'),
  PG_PASSWORD: z.string().min(1).default('CHANGE_ME'),
  INDEXER_HTTP_PORT: z.coerce.number().int().positive().default(3001),
  START_BLOCK: z.coerce.number().int().nonnegative().default(0),
  BATCH_SIZE: z.coerce.number().int().positive().default(100),
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof ConfigSchema>;

const parsed = ConfigSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config: Config = parsed.data;

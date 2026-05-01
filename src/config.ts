import { z } from 'zod';
import 'dotenv/config';

const optionalNonNegativeInt = z.preprocess(
  (value) => (value === '' || value === undefined ? undefined : value),
  z.coerce.number().int().nonnegative().optional(),
);

const ConfigSchema = z.object({
  NODE_URL: z.string().url().default('http://127.0.0.1:57291'),
  DATABASE_URL: z.string().url().optional(),
  PG_HOST: z.string().default('localhost'),
  PG_PORT: z.coerce.number().int().positive().default(5432),
  PG_DB: z.string().default('miden_indexer'),
  PG_USER: z.string().default('miden'),
  PG_PASSWORD: z.string().min(1).optional(),
  PG_SSL: z.enum(['disable', 'require', 'verify-full']).default('disable'),
  PG_SSL_CA: z.string().optional(),
  INDEXER_HTTP_PORT: z.coerce.number().int().positive().default(3001),
  API_BIND: z.string().default('0.0.0.0'),
  START_BLOCK: optionalNonNegativeInt,
  BATCH_SIZE: z.coerce.number().int().positive().default(200),
  POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(1_500),
  BACKFILL_CONCURRENCY: z.coerce.number().int().positive().max(100).default(16),
  MAX_LAG_BLOCKS_BEFORE_BATCH: z.coerce.number().int().nonnegative().default(5),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LOG_FORMAT: z.enum(['pretty', 'json']).default('pretty'),
  METRICS_ENABLED: z
    .string()
    .transform((v) => v.toLowerCase() === 'true')
    .default('true'),
  METRICS_SAMPLE_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
});

export type Config = z.infer<typeof ConfigSchema>;

const parsed = ConfigSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config: Config = parsed.data;

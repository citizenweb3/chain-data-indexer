import { z } from 'zod';
import 'dotenv/config';

const ConfigSchema = z.object({
  NODE_URL: z.string().url().default('http://localhost:8080'),
  PG_HOST: z.string().default('localhost'),
  PG_PORT: z.coerce.number().default(5432),
  PG_DB: z.string().default('logos_indexer'),
  PG_USER: z.string().default('logos'),
  PG_PASSWORD: z.string(),
  PG_SSL: z
    .string()
    .transform((v) => v.toLowerCase() === 'true')
    .default('false'),
  PG_SSL_CA: z.string().optional(),
  FROM_SLOT: z.coerce.number().default(0),
  FOLLOW: z
    .string()
    .transform((v) => v.toLowerCase() === 'true')
    .default('true'),
  BATCH_SIZE: z.coerce.number().default(500),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LOG_FORMAT: z.enum(['pretty', 'json']).default('pretty'),
  API_PORT: z.coerce.number().default(3001),
  API_BIND: z.string().default('0.0.0.0'),
  METRICS_ENABLED: z
    .string()
    .transform((v) => v.toLowerCase() === 'true')
    .default('true'),
  METRICS_SAMPLE_INTERVAL_MS: z.coerce.number().default(5000),
});

export type Config = z.infer<typeof ConfigSchema>;

const parsed = ConfigSchema.safeParse({
  ...process.env,
  // Backward-compatible alias for deployments that already set HEALTH_PORT.
  API_PORT: process.env.API_PORT ?? process.env.HEALTH_PORT,
});
if (!parsed.success) {
  console.error('Invalid configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config: Config = parsed.data;

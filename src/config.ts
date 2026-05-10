import { z } from 'zod';
import 'dotenv/config';

const ConfigSchema = z.object({
  NODE_URL: z.string().url().default('http://localhost:18089'),
  PG_HOST: z.string().default('localhost'),
  PG_PORT: z.coerce.number().default(5432),
  PG_DB: z.string().default('monero_indexer'),
  PG_USER: z.string().default('monero'),
  PG_PASSWORD: z.string(),
  PG_SSL: z
    .string()
    .transform((v) => v.toLowerCase() === 'true')
    .default('false'),
  PG_SSL_CA: z.string().optional(),
  FROM_HEIGHT: z.coerce.number().min(0).default(0),
  FOLLOW: z
    .string()
    .transform((v) => v.toLowerCase() === 'true')
    .default('true'),
  BATCH_SIZE: z.coerce.number().min(1).default(200),
  RPC_CONCURRENCY: z.coerce.number().min(1).max(64).default(16),
  TX_BATCH_SIZE: z.coerce.number().min(1).default(200),
  FOLLOW_POLL_INTERVAL_MS: z.coerce.number().min(1_000).default(10_000),
  SETTLEMENT_DEPTH: z.coerce.number().min(0).default(20),
  SUPPLY_ENABLED: z
    .string()
    .transform((v) => v.toLowerCase() === 'true')
    .default('true'),
  SUPPLY_CHUNK_SIZE: z.coerce.number().min(1).default(25_000),
  SUPPLY_UPDATE_INTERVAL_MS: z.coerce.number().min(60_000).default(3_600_000),
  HEALTH_MAX_LAG_BLOCKS: z.coerce.number().min(0).default(50),
  HEALTH_MAX_STALL_MS: z.coerce.number().min(1_000).default(300_000),
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

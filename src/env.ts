import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  API_KEY: z.string().min(1),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

type Env = z.infer<typeof schema>;

const skip = process.env.SKIP_ENV_VALIDATION === '1' || process.env.NEXT_PHASE === 'phase-production-build';

let resolved: Env;
if (skip) {
  resolved = {
    DATABASE_URL: process.env.DATABASE_URL ?? '',
    API_KEY: process.env.API_KEY ?? '',
    LOG_LEVEL: (process.env.LOG_LEVEL as Env['LOG_LEVEL']) ?? 'info',
    PORT: process.env.PORT ? Number(process.env.PORT) : 3000,
    NODE_ENV: (process.env.NODE_ENV as Env['NODE_ENV']) ?? 'development',
  };
} else {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  resolved = parsed.data;
}

export const env = resolved;

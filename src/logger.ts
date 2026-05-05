import pino from 'pino';
import { env } from '@/env';

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'DATABASE_URL',
      'API_KEY',
      'req.headers["x-api-key"]',
      '*.password',
      '*.secret',
      '*.api_key',
      '*.apiKey',
      '*.x-api-key',
    ],
    censor: '[REDACTED]',
  },
  serializers: {
    // Drop stack and PG-specific fields (.detail, .where, .schema, .table, .constraint)
    // to avoid leaking query fragments and schema info in logs.
    err: (err: unknown) => {
      if (!err || typeof err !== 'object') return err;
      const e = err as Record<string, unknown>;
      return {
        type: (e['constructor'] as { name?: string } | undefined)?.name ?? 'Error',
        message: e['message'],
        code: e['code'],
      };
    },
  },
  ...(env.NODE_ENV === 'development' && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true },
    },
  }),
});

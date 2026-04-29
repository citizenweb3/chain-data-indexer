import winston from 'winston';
import { config } from '../config.js';

function safeSerialize(obj: unknown): string {
  return JSON.stringify(obj, (_key, value: unknown) => {
    if (value instanceof Error) {
      return { name: value.name, message: value.message, stack: value.stack };
    }
    return value;
  });
}

export const logger = winston.createLogger({
  level: config.LOG_LEVEL,
  defaultMeta: { service: 'miden-indexer' },
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      const extras = Object.keys(meta).length ? ' ' + safeSerialize(meta) : '';
      return `${timestamp} [${level.toUpperCase()}] ${message}${extras}`;
    }),
  ),
  transports: [new winston.transports.Console()],
});

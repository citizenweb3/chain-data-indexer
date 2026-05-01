import winston from 'winston';
import { config } from '../config.js';

const DEFAULT_LABEL = 'logos-indexer';

function serializeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) return value.map(serializeValue);
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      output[key] = serializeValue(nested);
    }
    return output;
  }
  return value;
}

function safeSerialize(obj: unknown): string {
  return JSON.stringify(serializeValue(obj));
}

function metadataFrom(meta: Record<string, unknown>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (key === 'label') continue;
    metadata[key] = serializeValue(value);
  }
  return metadata;
}

const prettyFormat = winston.format.printf((info) => {
  const { timestamp, level, message, ...meta } = info as Record<string, unknown>;
  const extras = Object.keys(meta).length ? ' ' + safeSerialize(meta) : '';
  return `${String(timestamp)} [${String(level).toUpperCase()}] ${String(message)}${extras}`;
});

const jsonFormat = winston.format.printf((info) => {
  const { timestamp, level, message, ...meta } = info as Record<string, unknown>;
  const label = typeof meta.label === 'string' ? meta.label : DEFAULT_LABEL;
  return JSON.stringify({
    ts: timestamp,
    level,
    label,
    message,
    metadata: metadataFrom(meta),
  });
});

export const logger = winston.createLogger({
  level: config.LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp(),
    config.LOG_FORMAT === 'json' ? jsonFormat : prettyFormat,
  ),
  transports: [new winston.transports.Console()],
});

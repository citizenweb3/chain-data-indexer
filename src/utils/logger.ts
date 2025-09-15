// src/utils/logger.ts
import winston from 'winston';

/**
 * Converts an arbitrary text value to a winston level.
 * Supports standard npm levels as well as aliases `trace` → `silly`, `log` → `info`.
 *
 * @param l String representation of the level (may be undefined).
 * @returns Normalized logging level for winston.
 */
function mapLevel(l?: string): winston.LoggerOptions['level'] {
  const x = (l || '').toLowerCase();
  if (['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'].includes(x)) return x as any;
  if (x === 'trace') return 'silly';
  if (x === 'log') return 'info';
  return 'info';
}

type Env = 'development' | 'production' | 'test';
const env: Env = (process.env.NODE_ENV as Env) || 'development';

const splatFormat = winston.format.splat();
const metadataFormat = winston.format.metadata({
  fillExcept: ['timestamp', 'level', 'message', 'label', 'stack'],
});

const baseFormat = winston.format.combine(
  winston.format.timestamp({ format: () => new Date().toISOString() }),
  winston.format.errors({ stack: true }),
);

const devFormat = winston.format.combine(
  baseFormat,
  splatFormat,
  metadataFormat,
  winston.format.colorize({ all: true }),
  winston.format.printf((info) => {
    const { timestamp, level, message, stack, label } = info as any;
    const metaObj = (info as any).metadata ?? {};
    const metaStr = Object.keys(metaObj).length ? ` ${JSON.stringify(metaObj)}` : '';
    const where = label ? `[${label}]` : '';
    const line = stack ? `${message}\n${stack}` : message;
    return `${timestamp} ${where} ${level}: ${line}${metaStr}`;
  }),
);

const prodFormat = winston.format.combine(baseFormat, splatFormat, metadataFormat, winston.format.json());

let root: winston.Logger | null = null;

/**
 * Creates the root logger with a console transport.
 * The default format depends on NODE_ENV: JSON in production, otherwise colored human-readable.
 *
 * @param options Overrides for level and output format.
 * @param options.level Logging level (error|warn|info|http|verbose|debug|silly|trace|log).
 * @param options.json Force JSON format.
 * @returns The root logger instance.
 */
function buildRoot(options?: { level?: string; json?: boolean }) {
  const level = mapLevel(options?.level ?? process.env.LOG_LEVEL);
  const useJson = options?.json ?? env === 'production';

  const transports: winston.transport[] = [new winston.transports.Console({ handleExceptions: true })];

  return winston.createLogger({
    level,
    levels: winston.config.npm.levels,
    format: useJson ? prodFormat : devFormat,
    defaultMeta: { app: 'cosmos-indexer', env },
    transports,
    silent: env === 'test',
  });
}

/**
 * Ensures the root logger is initialized and returns it.
 *
 * @returns The root logger.
 */
function ensureRoot() {
  if (!root) root = buildRoot();
  return root!;
}

/**
 * Initializes (or reinitializes) the root logger.
 * Call once at application start if you need to set level/format.
 *
 * @param options Initialization parameters.
 * @param options.level Logging level.
 * @param options.json JSON format instead of readable text.
 * @returns The root logger.
 */
export function initLogger(options?: { level?: string; json?: boolean }) {
  root = buildRoot(options);
  return root;
}

/**
 * Returns a child logger with the specified module label.
 *
 * @param label Label (usually a file path or module name).
 * @returns Child logger with added label field.
 */
export function getLogger(label: string): winston.Logger {
  const r = ensureRoot();
  return r.child({ label });
}

/**
 * Changes the logging level on the fly for the root logger and all its children.
 *
 * @param level New logging level.
 */
export function setLogLevel(level: string) {
  ensureRoot().level = mapLevel(level)!;
}

/**
 * Asynchronously closes transports and waits for buffer flush.
 * Useful to call before clean process exit.
 */
export async function flushLogger() {
  const logger = ensureRoot();
  await new Promise<void>((resolve) => {
    logger.on('finish', () => resolve());
    logger.end();
  });
}

/**
 * Returns the current root logger (initializing it if necessary).
 *
 * @returns The root logger.
 */
export function getRootLogger() {
  return ensureRoot();
}

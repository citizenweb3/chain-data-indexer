import pino, { type Logger as PinoLogger } from 'pino';

export type Logger = {
  logInfo: (message: string, extra?: unknown) => void;
  logError: (message: string, err?: unknown) => void;
  logWarn: (message: string, extra?: unknown) => void;
  logDebug: (message: string, extra?: unknown) => void;
};

const base: PinoLogger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport:
    process.env.NODE_ENV === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } },
});

const loggers: Record<string, Logger> = {};

const logger = (scope = 'default'): Logger => {
  const existing = loggers[scope];
  if (existing) return existing;

  const child = base.child({ scope });

  const wrap: Logger = {
    logInfo: (message, extra) =>
      extra === undefined ? child.info(message) : child.info({ extra }, message),
    logError: (message, err) =>
      err === undefined ? child.error(message) : child.error({ err }, message),
    logWarn: (message, extra) =>
      extra === undefined ? child.warn(message) : child.warn({ extra }, message),
    logDebug: (message, extra) =>
      extra === undefined ? child.debug(message) : child.debug({ extra }, message),
  };

  loggers[scope] = wrap;
  return wrap;
};

export default logger;

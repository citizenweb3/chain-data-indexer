import winston from 'winston';
import { config } from '../config.js';

export const logger = winston.createLogger({
  level: config.LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      const extras = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
      return `${timestamp} [${level.toUpperCase()}] ${message}${extras}`;
    }),
  ),
  transports: [new winston.transports.Console()],
});

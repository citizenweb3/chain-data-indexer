import { logger } from '../utils/logger.js';

export async function startFollow(): Promise<() => void> {
  logger.info('follow not yet implemented');
  return () => undefined;
}

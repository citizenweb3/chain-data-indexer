import { logger } from './logger.js';

const RETRYABLE_CODES = new Set([429, 500, 502, 503, 504]);

function isRetryable(err: unknown): boolean {
  if (err && typeof err === 'object') {
    // axios error
    const status: unknown = (err as Record<string, unknown>).status
      ?? (err as Record<string, Record<string, unknown>>).response?.status;
    if (typeof status === 'number') return RETRYABLE_CODES.has(status);
    // network-level errors (ECONNRESET, ETIMEDOUT, etc.)
    const code: unknown = (err as Record<string, unknown>).code;
    if (typeof code === 'string') return true;
  }
  return false;
}

/**
 * Retry an async operation with exponential backoff and jitter.
 * Only retries on network errors and 5xx / 429 status codes.
 * Throws immediately on 4xx (except 429).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 5,
  baseMs = 1_000,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === maxAttempts) throw err;
      const delay = Math.min(baseMs * 2 ** (attempt - 1), 30_000);
      const jitter = Math.random() * delay * 0.2;
      const wait = Math.round(delay + jitter);
      logger.warn(`RPC attempt ${attempt}/${maxAttempts} failed — retrying in ${wait}ms`, { err });
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

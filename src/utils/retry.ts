import { logger } from './logger.js';

const RETRYABLE_CODES = new Set([429, 500, 502, 503, 504]);

/**
 * Thrown when a gRPC RESOURCE_EXHAUSTED (rate-limit) response is received.
 * Carries the server-suggested retry delay so the retry loop can honour it.
 */
export class RateLimitError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super(`Rate limited; retry after ${retryAfterMs}ms`);
    this.name = 'RateLimitError';
  }
}

function isRetryable(err: unknown): boolean {
  if (err instanceof RateLimitError) return true;
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
 * Full-jitter exponential backoff for rate-limit errors (AWS recommended pattern).
 * Randomises within [0, min(cap, base * 2^attempt)] to avoid thundering-herd
 * while still backing off quickly under sustained pressure.
 */
function rateLimitDelayMs(attempt: number, hintMs: number): number {
  const base = Math.max(hintMs, 5_000); // floor: 5 s regardless of server hint
  const cap = 120_000;                  // ceiling: 2 min
  const ceiling = Math.min(cap, base * 2 ** (attempt - 1));
  return Math.round(Math.random() * ceiling);
}

/**
 * Standard exponential backoff with ±20 % jitter for transient errors.
 */
function transientDelayMs(attempt: number, baseMs: number): number {
  const delay = Math.min(baseMs * 2 ** (attempt - 1), 30_000);
  return Math.round(delay + Math.random() * delay * 0.2);
}

/**
 * Retry an async operation with exponential backoff and jitter.
 *
 * - Network errors / 5xx / 429: standard exponential backoff.
 * - RateLimitError (gRPC RESOURCE_EXHAUSTED): full-jitter backoff starting at
 *   max(server_hint, 5 s), doubling each attempt, capped at 2 min.
 *
 * Throws immediately on non-retryable errors or after maxAttempts exhausted.
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
      const isRateLimit = err instanceof RateLimitError;
      const wait = isRateLimit
        ? rateLimitDelayMs(attempt, err.retryAfterMs)
        : transientDelayMs(attempt, baseMs);
      logger.warn(`RPC attempt ${attempt}/${maxAttempts} failed — retrying in ${wait}ms`, {
        err,
        rate_limited: isRateLimit,
      });
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

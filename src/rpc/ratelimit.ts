/**
 * Implements a simple token bucket rate limiter.
 * Allows throttling of operations to a defined rate per second with a configurable burst multiplier.
 */
// src/rpc/ratelimit.ts
import { getLogger } from '../utils/logger.js';

const logger = getLogger('rpc/ratelimit');

/**
 * Represents a token bucket with a method to take tokens.
 */
export type TokenBucket = {
  take: (n?: number) => Promise<void>;
};

/**
 * Creates a token bucket rate limiter.
 *
 * @param {number} rps - Allowed rate in requests per second.
 * @param {number} [burstMultiplier=2] - Multiplier for burst capacity.
 * @returns {TokenBucket} A token bucket instance with a take method to consume tokens.
 */
export function createTokenBucket(rps: number, burstMultiplier = 2): TokenBucket {
  const capacity = Math.max(1, Math.floor(rps * burstMultiplier));
  let tokens = capacity;
  /**
   * tokens/ms
   */
  const refillPerMs = rps / 1000;
  let last = Date.now();

  function refill() {
    const now = Date.now();
    const elapsed = now - last;
    if (elapsed > 0) {
      tokens = Math.min(capacity, tokens + elapsed * refillPerMs);
      last = now;
    }
  }

  /**
   * Attempts to take a specified number of tokens from the bucket.
   * Waits if there are not enough tokens available.
   *
   * @param {number} [n=1] - Number of tokens to take.
   * @returns {Promise<void>} Resolves when the requested tokens have been taken.
   */
  async function take(n = 1): Promise<void> {
    refill();
    if (tokens >= n) {
      tokens -= n;
      logger.debug(`took ${n} token(s), remaining=${tokens.toFixed(2)}`);
      return;
    }
    const deficit = n - tokens;
    const ms = Math.max(1, Math.ceil(deficit / refillPerMs));
    logger.debug(`waiting ${ms}ms for ${deficit.toFixed(2)} token(s)`);
    await new Promise((r) => setTimeout(r, ms));
    refill();
    tokens = Math.max(0, tokens - n);
    logger.debug(`took ${n} token(s), remaining=${tokens.toFixed(2)}`);
  }

  return { take };
}

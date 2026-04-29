// src/rpc/client.ts
/**
 * This module provides an RPC client with rate limiting and retry logic
 * for interacting with Cosmos-based chains.
 */
// @ts-ignore
import { Agent, setGlobalDispatcher, fetch } from 'undici';
import { createTokenBucket, TokenBucket } from './ratelimit.js';
import { getLogger } from '../utils/logger.js';
import { LogLevel } from '../types.js';

const agent = new Agent({
  connections: 128,
  keepAliveTimeout: 10_000,
  keepAliveMaxTimeout: 60_000,
});
setGlobalDispatcher(agent);

/**
 * Options for configuring the RPC client.
 * @property {string} baseUrl - RPC endpoint URL.
 * @property {number} timeoutMs - Per-request timeout in milliseconds.
 * @property {number} retries - Number of retries for transient errors.
 * @property {number} backoffMs - Base backoff delay in milliseconds.
 * @property {number} backoffJitter - Jitter factor between 0 and 1.
 * @property {number} rps - Target requests per second for token bucket rate limiting.
 * @property {Record<string, string>=} headers - Optional HTTP headers.
 */
export type RpcClientOptions = {
  baseUrl: string; // http(s)://host:26657
  timeoutMs: number; // per-request timeout
  retries: number; // max retries for transient/5xx
  backoffMs: number; // base backoff
  backoffJitter: number; // 0..1
  rps: number; // target req/s (token bucket)
  headers?: Record<string, string>;
};

/**
 * Interface defining the public methods of the RPC client.
 * @interface RpcClient
 * @method getJson - Performs a GET request and returns parsed JSON.
 * @method fetchBlock - Fetches block data at a given height.
 * @method fetchBlockResults - Fetches block results at a given height.
 * @method fetchStatus - Fetches the node status.
 */
export type RpcClient = {
  getJson: <T = any>(path: string, params?: Record<string, string | number | boolean | undefined>) => Promise<T>;
  fetchBlock: (height: number) => Promise<any>;
  fetchBlockResults: (height: number) => Promise<any>;
  fetchStatus: () => Promise<any>;
};

const log = getLogger('rpc/client');

/**
 * Sleeps for the specified number of milliseconds.
 * @param {number} ms - Milliseconds to sleep.
 * @returns {Promise<void>} Promise that resolves after the delay.
 */
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Applies jitter to a base value.
 * @param {number} base - Base value.
 * @param {number} j - Jitter factor (0..1).
 * @returns {number} Value after applying jitter.
 */
function jitter(base: number, j: number) {
  if (j <= 0) return base;
  const delta = base * j;
  return base + (Math.random() * 2 - 1) * delta;
}

const RETRYABLE_RPC_ERROR_CODES = new Set([
  'ABORT_ERR',
  'ECONNRESET',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EPIPE',
]);

function collectErrorChain(e: unknown): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = e;

  while (current && typeof current === 'object' && chain.length < 8) {
    chain.push(current);
    current = (current as { cause?: unknown }).cause;
  }

  if (chain.length === 0) chain.push(e);
  return chain;
}

export function isRetryableRpcError(e: unknown): boolean {
  for (const item of collectErrorChain(e)) {
    const err = item as { name?: unknown; code?: unknown; message?: unknown };
    const name = typeof err.name === 'string' ? err.name : '';
    const code = typeof err.code === 'string' ? err.code : '';
    const message = typeof err.message === 'string' ? err.message : String(item);

    if (name === 'AbortError') return true;
    if (RETRYABLE_RPC_ERROR_CODES.has(code) || code.startsWith('UND_ERR_')) return true;
    if (/^HTTP (429|5\d\d)\b/.test(message)) return true;
    if (/^timeout: fetch(Block|BlockResults|Status)?@?.* after \d+ms/.test(message)) return true;
    if (
      /fetch failed|other side closed|socket hang up|terminated|connect timeout|headers timeout|body timeout/i.test(
        message,
      )
    ) {
      return true;
    }
  }

  return false;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function waitForRpcStatus(
  rpc: Pick<RpcClient, 'fetchStatus'>,
  opts: {
    label?: string;
    initialDelayMs?: number;
    maxDelayMs?: number;
    jitter?: number;
    logEveryAttempts?: number;
  } = {},
): Promise<any> {
  const label = opts.label ?? 'rpc';
  const maxDelayMs = opts.maxDelayMs ?? 30_000;
  const jitterFactor = opts.jitter ?? 0.3;
  const logEveryAttempts = opts.logEveryAttempts ?? 10;
  let delayMs = opts.initialDelayMs ?? 1_000;
  let attempt = 0;

  for (;;) {
    try {
      const status = await rpc.fetchStatus();
      if (attempt > 0) {
        log.info(`[rpc] ${label}: RPC is available again after ${attempt} retries`);
      }
      return status;
    } catch (e) {
      if (!isRetryableRpcError(e)) throw e;

      attempt++;
      const waitMs = Math.max(100, Math.floor(jitter(Math.min(delayMs, maxDelayMs), jitterFactor)));
      if (attempt === 1 || attempt % logEveryAttempts === 0) {
        log.warn(`[rpc] ${label}: RPC unavailable, retrying in ${waitMs}ms (attempt ${attempt}): ${errorMessage(e)}`);
      }
      await sleep(waitMs);
      delayMs = Math.min(maxDelayMs, delayMs * 2);
    }
  }
}

/**
 * Builds a full URL from a base URL, path, and optional query parameters.
 * @param {string} base - Base URL.
 * @param {string} path - URL path.
 * @param {Record<string, string | number | boolean | undefined>=} params - Query parameters.
 * @returns {string} Full URL string.
 */
function buildUrl(base: string, path: string, params?: Record<string, string | number | boolean | undefined>) {
  const u = new URL(path.replace(/^\/+/, '/'), base.replace(/\/+$/, '/'));
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      u.searchParams.set(k, String(v));
    }
  }
  return u.toString();
}

/**
 * Creates and configures a new RpcClient with the given options.
 * @param {RpcClientOptions} opts - Configuration options.
 * @returns {RpcClient} Configured RPC client instance.
 */
export function createRpcClient(opts: RpcClientOptions): RpcClient {
  const bucket: TokenBucket = createTokenBucket(Math.max(1, Math.floor(opts.rps)), 2);
  const headers: Record<string, string> = {
    accept: 'application/json',
    'accept-encoding': 'gzip, br',
    connection: 'keep-alive',
    ...(opts.headers ?? {}),
  };

  async function getJson<T = any>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    const url = buildUrl(opts.baseUrl, path, params);

    for (let attempt = 0; attempt <= opts.retries; attempt++) {
      await bucket.take(1);

      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), opts.timeoutMs);

      try {
        const res = await fetch(url, { method: 'GET', headers, signal: ac.signal });
        clearTimeout(t);

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          const err = new Error(`HTTP ${res.status} ${res.statusText} for ${url} :: ${text.slice(0, 200)}`);
          if ((res.status >= 500 || res.status === 429) && attempt < opts.retries) {
            const delay = jitter(opts.backoffMs * Math.pow(2, attempt), opts.backoffJitter);
            log.debug('retry http', { attempt, delay, status: res.status });
            await sleep(delay);
            continue;
          }
          throw err;
        }

        return (await res.json()) as T;
      } catch (e: any) {
        clearTimeout(t);
        const transient = isRetryableRpcError(e);
        if (transient && attempt < opts.retries) {
          const delay = jitter(opts.backoffMs * Math.pow(2, attempt), opts.backoffJitter);
          log.debug('retry net', { attempt, delay, error: String(e?.message ?? e) });
          await sleep(delay);
          continue;
        }
        throw e;
      }
    }
    throw new Error('unreachable');
  }

  async function fetchBlock(height: number): Promise<any> {
    const j = await getJson<any>('/block', { height });
    return j.result ?? j;
  }

  async function fetchBlockResults(height: number): Promise<any> {
    const j = await getJson<any>('/block_results', { height });
    return j.result ?? j;
  }

  async function fetchStatus(): Promise<any> {
    const j = await getJson<any>('/status');
    return j.result ?? j;
  }

  return { getJson, fetchBlock, fetchBlockResults, fetchStatus };
}

/**
 * Creates an RpcClient from a simplified configuration object.
 * @param {object} cfg - Configuration object.
 * @param {string} cfg.rpcUrl - RPC endpoint URL.
 * @param {number} cfg.timeoutMs - Per-request timeout in milliseconds.
 * @param {number} cfg.retries - Number of retries for transient errors.
 * @param {number} cfg.backoffMs - Base backoff delay in milliseconds.
 * @param {number} cfg.backoffJitter - Jitter factor between 0 and 1.
 * @param {number} cfg.rps - Target requests per second for token bucket rate limiting.
 * @param {LogLevel} cfg.logLevel - Optional log level.
 * @returns {RpcClient} Configured RPC client instance.
 */
export function createRpcClientFromConfig(cfg: {
  rpcUrl: string;
  timeoutMs: number;
  retries: number;
  backoffMs: number;
  backoffJitter: number;
  rps: number;
  logLevel?: LogLevel;
}) {
  return createRpcClient({
    baseUrl: cfg.rpcUrl,
    timeoutMs: cfg.timeoutMs,
    retries: cfg.retries,
    backoffMs: cfg.backoffMs,
    backoffJitter: cfg.backoffJitter,
    rps: cfg.rps,
  });
}

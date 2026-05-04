import axios from 'axios';
import http from 'node:http';
import https from 'node:https';
import readline from 'node:readline';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import { observeRpc } from '../metrics/registry.js';
import type {
  CryptarchiaInfo,
  NetworkInfo,
  LogosBlock,
  BlockStreamEvent,
  LibStreamEvent,
} from '../types.js';

const httpClient = axios.create({ baseURL: config.NODE_URL, timeout: 30_000 });

type RpcStatus = 'ok' | 'timeout' | 'error';

function durationSecondsSince(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1_000_000_000;
}

function classifyRpcError(err: unknown): RpcStatus {
  if (err && typeof err === 'object') {
    const record = err as Record<string, unknown>;
    const code = record.code;
    const name = record.name;
    const message = record.message;
    if (name === 'AbortError') return 'timeout';
    if (typeof code === 'string' && /timeout|timedout|etimedout|econnaborted/i.test(code)) {
      return 'timeout';
    }
    if (typeof message === 'string' && /timeout|timed out|aborted/i.test(message)) {
      return 'timeout';
    }
  }
  return 'error';
}

async function instrumentRpc<T>(endpoint: string, fn: () => Promise<T>): Promise<T> {
  const start = process.hrtime.bigint();
  let status: RpcStatus = 'ok';
  try {
    return await fn();
  } catch (err) {
    status = classifyRpcError(err);
    throw err;
  } finally {
    observeRpc(endpoint, status, durationSecondsSince(start));
  }
}

export async function fetchInfo(
  timeoutMs = 30_000,
  maxAttempts = 5,
): Promise<CryptarchiaInfo> {
  return withRetry(() => instrumentRpc('/cryptarchia/info', async () => {
    const { data } = await httpClient.get<CryptarchiaInfo>('/cryptarchia/info', {
      timeout: timeoutMs,
    });
    return data;
  }), maxAttempts);
}

export async function fetchNetworkInfo(): Promise<NetworkInfo> {
  return withRetry(() => instrumentRpc('/network/info', async () => {
    const { data } = await httpClient.get<NetworkInfo>('/network/info');
    return data;
  }));
}

/**
 * Fetch blocks in a slot range.
 * Returns an empty array if no blocks were produced in that range.
 */
export async function fetchBlocks(
  slotFrom: number,
  slotTo: number,
  timeoutMs = 60_000,
  maxAttempts = 5,
): Promise<LogosBlock[]> {
  return withRetry(() => instrumentRpc('/cryptarchia/blocks', async () => {
    const { data } = await httpClient.get<LogosBlock[]>('/cryptarchia/blocks', {
      params: { slot_from: slotFrom, slot_to: slotTo },
      timeout: timeoutMs,
    });
    return data;
  }), maxAttempts);
}

/**
 * Fetch a single block by its hash via /storage/block.
 * Note: the hash expected here is the chain tip/parent hash, NOT header.id from /cryptarchia/blocks.
 */
export async function fetchBlockByHash(hash: string): Promise<LogosBlock> {
  return withRetry(() => instrumentRpc('/storage/block', async () => {
    const { data } = await httpClient.post<LogosBlock>(
      '/storage/block',
      JSON.stringify(hash),
      { headers: { 'Content-Type': 'application/json' } },
    );
    return data;
  }));
}

function parseBlockStreamLine(line: string): LogosBlock | null {
  const parsed = JSON.parse(line) as unknown;
  if (!parsed || typeof parsed !== 'object') return null;

  const record = parsed as Record<string, unknown>;
  if (record.block && typeof record.block === 'object' && typeof record.tip === 'string') {
    return (record as unknown as BlockStreamEvent).block;
  }

  if (record.header && typeof record.header === 'object') {
    return parsed as LogosBlock;
  }

  return null;
}

function parseBlockStreamEvent(line: string): BlockStreamEvent | null {
  const parsed = JSON.parse(line) as unknown;
  if (!parsed || typeof parsed !== 'object') return null;

  const record = parsed as Record<string, unknown>;
  if (record.block && typeof record.block === 'object' && typeof record.tip === 'string') {
    return parsed as BlockStreamEvent;
  }

  if (record.header && typeof record.header === 'object') {
    const block = parsed as LogosBlock;
    return {
      block,
      tip: typeof block.header.id === 'string' ? block.header.id : '',
      tip_slot: block.header.slot,
      lib: '',
      lib_slot: 0,
    };
  }

  return null;
}

/**
 * Subscribe to the live block NDJSON stream.
 * - Calls onBlock for each block event.
 * - Calls onError on stream errors or when the stall timer fires.
 * - Stall detection: polls fetchInfo every stalePollMs. If the node tip advances
 *   but no NDJSON message has been received for staleLimitMs, triggers reconnect.
 *   This is robust against sparse block production on testnet.
 * Returns a cleanup function to close the connection.
 */
export function subscribeBlocks(
  onBlock: (event: BlockStreamEvent) => void,
  onError?: (err: Error) => void,
  staleLimitMs = 120_000,
  stalePollMs  = 30_000,
): () => void {
  const url = new URL('/cryptarchia/events/blocks/stream', config.NODE_URL);
  const isHttps = url.protocol === 'https:';
  const request = isHttps ? https.request : http.request;
  const options: http.RequestOptions | https.RequestOptions = {
    hostname: url.hostname,
    port: Number(url.port) || (isHttps ? 443 : 80),
    path: url.pathname,
    method: 'GET',
    headers: { Accept: 'application/x-ndjson' },
  };

  let req: http.ClientRequest | null = null;
  let closed = false;
  let reported = false;
  let lastMessageAt = Date.now();
  let lastReceivedSlot = 0;

  function reportClose(err: Error): void {
    if (closed || reported) return;
    reported = true;
    if (onError) onError(err);
  }

  req = request(options, (res) => {
    if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
      reportClose(new Error(`Block stream returned HTTP ${res.statusCode}`));
      res.resume();
      return;
    }

    const rl = readline.createInterface({ input: res, crlfDelay: Infinity });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const event = parseBlockStreamEvent(trimmed);
        if (!event) {
          logger.warn('Ignoring malformed block stream event');
          return;
        }
        lastMessageAt = Date.now();
        lastReceivedSlot = event.block.header.slot;
        onBlock(event);
      } catch (err) {
        logger.warn('Ignoring malformed block stream line', { err });
      }
    });

    rl.on('error', (err) => reportClose(err));
    rl.on('close', () => reportClose(new Error('Block stream closed')));
    res.on('error', (err) => reportClose(err));
    res.on('aborted', () => reportClose(new Error('Block stream aborted')));
  });

  req.on('error', (err) => reportClose(err));
  req.end();

  // Heartbeat: periodically check if the node tip is advancing without us
  // receiving events. This catches silent NDJSON stalls (connection open but dead).
  const heartbeat = setInterval(async () => {
    try {
      const info = await fetchInfo();
      const sinceLastMsg = Date.now() - lastMessageAt;

      if (info.slot > lastReceivedSlot && sinceLastMsg > staleLimitMs) {
        logger.warn('Block stream stall detected: node tip advanced but no events received', {
          node_slot: info.slot,
          last_received_slot: lastReceivedSlot,
          last_msg_ago_s: Math.round(sinceLastMsg / 1_000),
        });
        clearInterval(heartbeat);
        req?.destroy();
        reportClose(new Error('Block stream stalled'));
      }
    } catch {
      // heartbeat fetch failed — not critical, stream error handler will catch stream issues
    }
  }, stalePollMs);
  heartbeat.unref();

  return () => {
    closed = true;
    clearInterval(heartbeat);
    req?.destroy();
  };
}

/**
 * Subscribe to the LIB (Last Irreversible Block) NDJSON stream.
 * The endpoint returns application/x-ndjson — one JSON object per line.
 * Calls onLib for each finality update; calls onError on stream errors.
 * Returns a cleanup function to abort the connection.
 */
export function subscribeLib(
  onLib: (event: LibStreamEvent) => void,
  onError?: (err: Error) => void,
  staleLimitMs = 120_000,
): () => void {
  const url = new URL('/cryptarchia/lib-stream', config.NODE_URL);
  const isHttps = url.protocol === 'https:';
  const request = isHttps ? https.request : http.request;
  const options: http.RequestOptions | https.RequestOptions = {
    hostname: url.hostname,
    port: Number(url.port) || (isHttps ? 443 : 80),
    path: url.pathname,
    method: 'GET',
    headers: { Accept: 'application/x-ndjson' },
  };

  let req: http.ClientRequest | null = null;
  let closed = false;
  let reported = false;

  function reportClose(err: Error): void {
    if (closed || reported) return;
    reported = true;
    if (onError) onError(err);
  }

  req = request(options, (res) => {
    if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
      reportClose(new Error(`LIB stream returned HTTP ${res.statusCode}`));
      res.resume();
      return;
    }

    const rl = readline.createInterface({ input: res, crlfDelay: Infinity });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const event = JSON.parse(trimmed) as LibStreamEvent;
        onLib(event);
      } catch {
        // malformed line — ignore
      }
    });
    rl.on('close', () => {
      reportClose(new Error('LIB stream reader closed'));
    });
    res.on('end', () => {
      reportClose(new Error('LIB stream ended'));
    });
    res.on('close', () => {
      reportClose(new Error('LIB stream closed'));
    });
    res.on('error', (err) => {
      reportClose(err);
    });
  });

  req.setTimeout(staleLimitMs, () => {
    reportClose(new Error(`LIB stream idle for ${staleLimitMs}ms`));
    req?.destroy();
  });

  req.on('error', (err) => {
    reportClose(err);
  });

  req.end();

  return () => {
    closed = true;
    req?.destroy();
  };
}

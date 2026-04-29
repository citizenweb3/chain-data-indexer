import axios from 'axios';
import EventSource from 'eventsource';
import http from 'node:http';
import readline from 'node:readline';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import type {
  CryptarchiaInfo,
  NetworkInfo,
  LogosBlock,
  BlockSseEvent,
  LibStreamEvent,
} from '../types.js';

const httpClient = axios.create({ baseURL: config.NODE_URL, timeout: 30_000 });

export async function fetchInfo(): Promise<CryptarchiaInfo> {
  return withRetry(async () => {
    const { data } = await httpClient.get<CryptarchiaInfo>('/cryptarchia/info');
    return data;
  });
}

export async function fetchNetworkInfo(): Promise<NetworkInfo> {
  return withRetry(async () => {
    const { data } = await httpClient.get<NetworkInfo>('/network/info');
    return data;
  });
}

/**
 * Fetch blocks in a slot range.
 * Returns an empty array if no blocks were produced in that range.
 */
export async function fetchBlocks(
  slotFrom: number,
  slotTo: number,
  timeoutMs = 60_000,
): Promise<LogosBlock[]> {
  const { data } = await httpClient.get<LogosBlock[]>('/cryptarchia/blocks', {
    params: { slot_from: slotFrom, slot_to: slotTo },
    timeout: timeoutMs,
  });
  return data;
}

/**
 * Fetch a single block by its hash via /storage/block.
 * Note: the hash expected here is the chain tip/parent hash, NOT header.id from /cryptarchia/blocks.
 */
export async function fetchBlockByHash(hash: string): Promise<LogosBlock> {
  const { data } = await httpClient.post<LogosBlock>(
    '/storage/block',
    JSON.stringify(hash),
    { headers: { 'Content-Type': 'application/json' } },
  );
  return data;
}

/**
 * Subscribe to the live block SSE stream.
 * - Calls onBlock for each block event.
 * - Calls onError on stream errors or when the stall timer fires.
 * - Stall detection: polls fetchInfo every stalePollMs. If the node tip advances
 *   but no SSE message has been received for staleLimitMs, triggers reconnect.
 *   This is robust against sparse block production on testnet.
 * Returns a cleanup function to close the connection.
 */
export function subscribeBlocks(
  onBlock: (block: BlockSseEvent) => void,
  onError?: (err: Event) => void,
  staleLimitMs = 120_000,
  stalePollMs  = 30_000,
): () => void {
  const url = `${config.NODE_URL}/cryptarchia/events/blocks/stream`;
  const es = new EventSource(url);

  let lastMessageAt = Date.now();
  let lastReceivedSlot = 0;

  es.onmessage = (event) => {
    lastMessageAt = Date.now();
    try {
      const block: BlockSseEvent = JSON.parse(event.data as string);
      lastReceivedSlot = block.header.slot;
      onBlock(block);
    } catch {
      // malformed SSE event — ignore
    }
  };

  if (onError) {
    es.onerror = onError;
  }

  // Heartbeat: periodically check if the node tip is advancing without us
  // receiving events. This catches silent SSE stalls (connection open but dead).
  const heartbeat = setInterval(async () => {
    try {
      const info = await fetchInfo();
      const sinceLastMsg = Date.now() - lastMessageAt;

      if (info.slot > lastReceivedSlot && sinceLastMsg > staleLimitMs) {
        logger.warn('SSE stall detected: node tip advanced but no events received', {
          node_slot: info.slot,
          last_received_slot: lastReceivedSlot,
          last_msg_ago_s: Math.round(sinceLastMsg / 1_000),
        });
        clearInterval(heartbeat);
        es.close();
        if (onError) onError(new Event('stall'));
      }
    } catch {
      // heartbeat fetch failed — not critical, SSE error handler will catch stream issues
    }
  }, stalePollMs);

  return () => {
    clearInterval(heartbeat);
    es.close();
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
): () => void {
  const url = new URL('/cryptarchia/lib-stream', config.NODE_URL);
  const options: http.RequestOptions = {
    hostname: url.hostname,
    port: Number(url.port) || 80,
    path: url.pathname,
    method: 'GET',
    headers: { Accept: 'application/x-ndjson' },
  };

  let req: http.ClientRequest | null = null;
  let closed = false;

  req = http.request(options, (res) => {
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
    res.on('error', (err) => {
      if (!closed && onError) onError(err);
    });
  });

  req.on('error', (err) => {
    if (!closed && onError) onError(err);
  });

  req.end();

  return () => {
    closed = true;
    req?.destroy();
  };
}

import axios from 'axios';
import EventSource from 'eventsource';
import { config } from '../config.js';
import type {
  CryptarchiaInfo,
  NetworkInfo,
  LogosBlock,
  BlockSseEvent,
} from '../types.js';

const http = axios.create({ baseURL: config.NODE_URL, timeout: 30_000 });

export async function fetchInfo(): Promise<CryptarchiaInfo> {
  const { data } = await http.get<CryptarchiaInfo>('/cryptarchia/info');
  return data;
}

export async function fetchNetworkInfo(): Promise<NetworkInfo> {
  const { data } = await http.get<NetworkInfo>('/network/info');
  return data;
}

/**
 * Fetch blocks in a slot range.
 * Returns an empty array if no blocks were produced in that range.
 */
export async function fetchBlocks(
  slotFrom: number,
  slotTo: number,
): Promise<LogosBlock[]> {
  const { data } = await http.get<LogosBlock[]>('/cryptarchia/blocks', {
    params: { slot_from: slotFrom, slot_to: slotTo },
  });
  return data;
}

/**
 * Fetch a single block by its hash via /storage/block.
 * Note: the hash expected here is the chain tip/parent hash, NOT header.id from /cryptarchia/blocks.
 */
export async function fetchBlockByHash(hash: string): Promise<LogosBlock> {
  const { data } = await http.post<LogosBlock>(
    '/storage/block',
    JSON.stringify(hash),
    { headers: { 'Content-Type': 'application/json' } },
  );
  return data;
}

/**
 * Subscribe to the live block SSE stream.
 * Calls onBlock for each block event; calls onError on stream errors.
 * Returns a cleanup function to close the connection.
 */
export function subscribeBlocks(
  onBlock: (block: BlockSseEvent) => void,
  onError?: (err: Event) => void,
): () => void {
  const url = `${config.NODE_URL}/cryptarchia/events/blocks/stream`;
  const es = new EventSource(url);

  es.onmessage = (event) => {
    try {
      const block: BlockSseEvent = JSON.parse(event.data as string);
      onBlock(block);
    } catch {
      // malformed SSE event — ignore
    }
  };

  if (onError) {
    es.onerror = onError;
  }

  return () => es.close();
}

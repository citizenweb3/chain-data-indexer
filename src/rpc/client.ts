import axios from 'axios';
import JSONbigFactory from 'json-bigint';
import { config } from '../config.js';
import { observeRpc } from '../metrics/registry.js';
import { withRetry } from '../utils/retry.js';
import type {
  MoneroAlternativeChain,
  MoneroBlockHeader,
  MoneroBlockJson,
  MoneroBlockResponse,
  MoneroCoinbaseTxSum,
  MoneroGetInfo,
  MoneroJsonRpcEnvelope,
  MoneroPruneStatus,
  MoneroRpcTransaction,
  MoneroSyncInfo,
} from '../types.js';

const JSONbig = JSONbigFactory({ storeAsString: true });

const httpClient = axios.create({
  baseURL: config.NODE_URL,
  timeout: 30_000,
  transformResponse: [(data) => {
    if (typeof data !== 'string' || data.length === 0) return data;
    return JSONbig.parse(data);
  }],
});

type RpcStatus = 'ok' | 'timeout' | 'error';

class MoneroRpcError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message);
    this.name = 'MoneroRpcError';
  }
}

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

function parseMoneroJson<T>(value: string): T {
  return JSONbig.parse(value) as T;
}

async function callJsonRpc<T>(
  method: string,
  params?: unknown,
  timeoutMs = 30_000,
  maxAttempts = 5,
): Promise<T> {
  return withRetry(
    () => instrumentRpc(`json_rpc:${method}`, async () => {
      const payload = params === undefined
        ? { jsonrpc: '2.0', id: '0', method }
        : { jsonrpc: '2.0', id: '0', method, params };
      const { data } = await httpClient.post<MoneroJsonRpcEnvelope<T>>('/json_rpc', payload, {
        timeout: timeoutMs,
        headers: { 'Content-Type': 'application/json' },
      });
      if (data.error) {
        throw new MoneroRpcError(`${method}: ${data.error.message}`, data.error.code);
      }
      if (!data.result) {
        throw new MoneroRpcError(`${method}: empty result`);
      }
      return data.result;
    }),
    maxAttempts,
  );
}

async function callPath<T>(
  path: string,
  body: unknown,
  timeoutMs = 30_000,
  maxAttempts = 5,
): Promise<T> {
  return withRetry(
    () => instrumentRpc(`path:${path}`, async () => {
      const { data } = await httpClient.post<T>(path, body, {
        timeout: timeoutMs,
        headers: { 'Content-Type': 'application/json' },
      });
      return data;
    }),
    maxAttempts,
  );
}

export { parseMoneroJson };

export async function fetchInfo(timeoutMs = 30_000, maxAttempts = 5): Promise<MoneroGetInfo> {
  return callJsonRpc<MoneroGetInfo>('get_info', undefined, timeoutMs, maxAttempts);
}

export async function fetchBlockCount(timeoutMs = 30_000, maxAttempts = 5): Promise<number> {
  const result = await callJsonRpc<{ count: number }>('get_block_count', undefined, timeoutMs, maxAttempts);
  return result.count;
}

export async function fetchPruneStatus(timeoutMs = 30_000, maxAttempts = 5): Promise<MoneroPruneStatus> {
  return callJsonRpc<MoneroPruneStatus>('prune_blockchain', { check: true }, timeoutMs, maxAttempts);
}

export async function fetchSyncInfo(timeoutMs = 30_000, maxAttempts = 5): Promise<MoneroSyncInfo> {
  return callJsonRpc<MoneroSyncInfo>('sync_info', undefined, timeoutMs, maxAttempts);
}

export async function fetchAlternateChains(
  timeoutMs = 30_000,
  maxAttempts = 5,
): Promise<MoneroAlternativeChain[]> {
  const result = await callJsonRpc<{ chains: MoneroAlternativeChain[] }>(
    'get_alternate_chains',
    undefined,
    timeoutMs,
    maxAttempts,
  );
  return result.chains ?? [];
}

export async function fetchBlockHeaderByHeight(
  height: number,
  timeoutMs = 30_000,
  maxAttempts = 5,
): Promise<MoneroBlockHeader> {
  const result = await callJsonRpc<{ block_header: MoneroBlockHeader }>(
    'get_block_header_by_height',
    { height },
    timeoutMs,
    maxAttempts,
  );
  return result.block_header;
}

export async function fetchBlockByHeight(
  height: number,
  timeoutMs = 30_000,
  maxAttempts = 5,
): Promise<MoneroBlockResponse> {
  return callJsonRpc<MoneroBlockResponse>('get_block', { height }, timeoutMs, maxAttempts);
}

export async function fetchBlockByHash(
  hash: string,
  timeoutMs = 30_000,
  maxAttempts = 5,
): Promise<MoneroBlockResponse> {
  return callJsonRpc<MoneroBlockResponse>('get_block', { hash }, timeoutMs, maxAttempts);
}

export async function fetchTransactions(
  hashes: string[],
  timeoutMs = 60_000,
  maxAttempts = 5,
): Promise<MoneroRpcTransaction[]> {
  if (hashes.length === 0) return [];
  const result = await callPath<{ txs?: MoneroRpcTransaction[]; status?: string }>(
    '/get_transactions',
    {
      txs_hashes: hashes,
      decode_as_json: true,
      prune: false,
      split: false,
    },
    timeoutMs,
    maxAttempts,
  );
  return result.txs ?? [];
}

export async function fetchCoinbaseTxSum(
  height: number,
  count: number,
  timeoutMs = 300_000,
  maxAttempts = 3,
): Promise<MoneroCoinbaseTxSum> {
  return callJsonRpc<MoneroCoinbaseTxSum>(
    'get_coinbase_tx_sum',
    { height, count },
    timeoutMs,
    maxAttempts,
  );
}

export function parseBlockJson(block: MoneroBlockResponse): MoneroBlockJson {
  return parseMoneroJson<MoneroBlockJson>(block.json);
}

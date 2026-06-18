import http from 'node:http';
import { config } from './config.js';
import { getPool } from './db/pg.js';
import { getProgress } from './db/progress.js';
import { metricsContentType, metricsText } from './metrics/registry.js';
import { getOpenApiDocument, swaggerHtml } from './openapi.js';
import { fetchInfo, fetchPruneStatus, fetchTransactions, parseMoneroJson } from './rpc/client.js';
import { buildDecodedMoneroTransaction } from './txDecode.js';
import { logger } from './utils/logger.js';
import type { MoneroTxJson } from './types.js';

const startedAt = Date.now();
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const STATS_CACHE_MS = 5_000;

type SortOrder = 'asc' | 'desc';

interface BlockApiRow {
  hash: string;
  prev_hash: string;
  height: string;
  timestamp: string;
  major_version: number;
  minor_version: number;
  nonce: string;
  block_size: string;
  block_weight: string;
  long_term_weight: string;
  num_txes: number;
  miner_tx_hash: string;
  reward_atomic: string;
  difficulty_hex: string;
  cumulative_difficulty_hex: string;
  orphan_status: boolean;
  is_canonical: boolean;
  is_settled: boolean;
  indexed_at: Date;
  coinbase_extra_hex: string | null;
  raw?: unknown;
}

interface TransactionApiRow {
  hash: string;
  block_hash: string;
  block_height: string;
  position: number;
  version: number;
  unlock_time: string;
  is_coinbase: boolean;
  inputs_count: number;
  outputs_count: number;
  extra_size: number;
  fee_atomic: string | null;
  size_bytes: string | null;
  in_pool: boolean;
  confirmations: string | null;
  indexed_at: Date;
  is_canonical: boolean;
  is_settled: boolean;
}

interface SupplyApiRow {
  height: string;
  block_hash: string;
  block_timestamp: string;
  cumulative_emission_atomic: string;
  cumulative_fee_atomic: string;
  source_method: string;
  computed_at: Date;
}

interface StatsApiRow {
  total_blocks: string;
  total_transactions: string;
  settled_blocks: string;
  latest_height: string | null;
  latest_settled_height: string | null;
}

interface StatsCache {
  expiresAt: number;
  body: Record<string, unknown>;
}

let statsCache: StatsCache | null = null;

function parseLimit(url: URL): number {
  const n = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

function parseOffset(url: URL): number {
  const n = Number(url.searchParams.get('offset') ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function parseBooleanFilter(url: URL, key: string, defaultValue: boolean | null): boolean | null {
  const value = url.searchParams.get(key);
  if (value === null) return defaultValue;
  if (value === 'all') return null;
  return value !== 'false';
}

function parseOrder(url: URL): SortOrder {
  return url.searchParams.get('order') === 'asc' ? 'asc' : 'desc';
}

function toNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`operation timed out after ${timeoutMs}ms`)), timeoutMs);
    timeout.unref();
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timeout);
        reject(err);
      },
    );
  });
}

async function fetchInfoQuick() {
  return withTimeout(fetchInfo(4_000, 1), 4_500).catch(() => null);
}

async function fetchPruneStatusQuick() {
  return withTimeout(fetchPruneStatus(4_000, 1), 4_500).catch(() => null);
}

function blockSummary(row: BlockApiRow): Record<string, unknown> {
  return {
    hash: row.hash,
    prev_hash: row.prev_hash,
    height: Number(row.height),
    timestamp: Number(row.timestamp),
    major_version: row.major_version,
    minor_version: row.minor_version,
    nonce: Number(row.nonce),
    block_size: Number(row.block_size),
    block_weight: Number(row.block_weight),
    long_term_weight: Number(row.long_term_weight),
    num_txes: row.num_txes,
    miner_tx_hash: row.miner_tx_hash,
    reward_atomic: row.reward_atomic,
    difficulty_hex: row.difficulty_hex,
    cumulative_difficulty_hex: row.cumulative_difficulty_hex,
    coinbase_extra_hex: row.coinbase_extra_hex,
    orphan_status: row.orphan_status,
    is_canonical: row.is_canonical,
    is_settled: row.is_settled,
    indexed_at: row.indexed_at,
  };
}

function transactionSummary(row: TransactionApiRow, raw: Record<string, unknown> | null = null): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    hash: row.hash,
    block_hash: row.block_hash,
    block_height: Number(row.block_height),
    position: row.position,
    version: row.version,
    unlock_time: row.unlock_time,
    is_coinbase: row.is_coinbase,
    inputs_count: row.inputs_count,
    outputs_count: row.outputs_count,
    extra_size: row.extra_size,
    fee_atomic: row.fee_atomic,
    size: toNumber(row.size_bytes),
    confirmations: toNumber(row.confirmations),
    in_pool: row.in_pool,
    is_canonical: row.is_canonical,
    is_settled: row.is_settled,
    indexed_at: row.indexed_at,
    safe_decode: buildDecodedMoneroTransaction({
      version: row.version,
      unlockTime: row.unlock_time,
      isCoinbase: row.is_coinbase,
      inputsCount: row.inputs_count,
      outputsCount: row.outputs_count,
      extraLength: row.extra_size,
      feeAtomic: row.fee_atomic,
    }),
  };
  if (raw) summary.raw = raw;
  return summary;
}

function supplySummary(row: SupplyApiRow): Record<string, unknown> {
  return {
    height: Number(row.height),
    block_hash: row.block_hash,
    block_timestamp: Number(row.block_timestamp),
    cumulative_emission_atomic: row.cumulative_emission_atomic,
    cumulative_fee_atomic: row.cumulative_fee_atomic,
    source_method: row.source_method,
    computed_at: row.computed_at,
  };
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function sendHtml(res: http.ServerResponse, html: string): void {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(html);
}

function sendNotFound(res: http.ServerResponse): void {
  sendJson(res, 404, { error: 'not_found' });
}

function sendMethodNotAllowed(res: http.ServerResponse): void {
  sendJson(res, 405, { error: 'method_not_allowed' });
}

async function handleMetrics(res: http.ServerResponse): Promise<void> {
  if (!config.METRICS_ENABLED) {
    sendNotFound(res);
    return;
  }

  res.writeHead(200, {
    'Content-Type': metricsContentType,
    'Cache-Control': 'no-store',
  });
  res.end(await metricsText());
}

async function handleHealth(res: http.ServerResponse): Promise<void> {
  try {
    const [progress, info, pruneStatus] = await Promise.all([
      getProgress(),
      fetchInfoQuick(),
      fetchPruneStatusQuick(),
    ]);

    const lagBlocks = info ? Math.max(0, info.height - Math.max(progress.lastHeight, 0)) : null;
    const progressAgeMs = progress.updatedAt ? Date.now() - progress.updatedAt.getTime() : null;
    const reasons: string[] = [];

    if (!info) reasons.push('node_unreachable');
    if (info?.busy_syncing || (info && !info.synchronized)) reasons.push('node_syncing');
    if (lagBlocks !== null && lagBlocks > config.HEALTH_MAX_LAG_BLOCKS) reasons.push('lag_blocks');
    if (progressAgeMs !== null && progressAgeMs > config.HEALTH_MAX_STALL_MS) reasons.push('progress_stale');

    const healthy = reasons.length === 0;
    sendJson(res, healthy ? 200 : 503, {
      status: healthy ? 'ok' : 'degraded',
      last_height: progress.lastHeight,
      last_hash: progress.lastHash,
      last_progress_at: progress.updatedAt,
      last_progress_age_ms: progressAgeMs,
      node_height: info?.height ?? null,
      node_target_height: info?.target_height ?? null,
      node_synchronized: info?.synchronized ?? null,
      node_busy_syncing: info?.busy_syncing ?? null,
      node_pruned: pruneStatus?.pruned ?? null,
      lag_blocks: lagBlocks,
      settlement_depth: config.SETTLEMENT_DEPTH,
      uptime_s: Math.floor((Date.now() - startedAt) / 1_000),
      reasons,
    });
  } catch (err) {
    sendJson(res, 503, { status: 'error', error: String(err) });
  }
}

async function handleStats(res: http.ServerResponse): Promise<void> {
  if (statsCache && statsCache.expiresAt > Date.now()) {
    sendJson(res, 200, statsCache.body);
    return;
  }

  const pool = getPool();
  const [statsResult, progress, info, pruneStatus, supplyResult] = await Promise.all([
    pool.query<StatsApiRow>(
      `SELECT
         COUNT(*) FILTER (WHERE is_canonical)::text AS total_blocks,
         (SELECT COUNT(*)::text
            FROM monero_transactions tx
            JOIN monero_blocks b ON b.hash = tx.block_hash
           WHERE b.is_canonical) AS total_transactions,
         COUNT(*) FILTER (WHERE is_settled)::text AS settled_blocks,
         MAX(height) FILTER (WHERE is_canonical)::text AS latest_height,
         MAX(height) FILTER (WHERE is_settled)::text AS latest_settled_height
        FROM monero_blocks`,
    ),
    getProgress(),
    fetchInfoQuick(),
    fetchPruneStatusQuick(),
    pool.query<SupplyApiRow>(
      `SELECT height::text, block_hash, block_timestamp::text, cumulative_emission_atomic,
              cumulative_fee_atomic, source_method, computed_at
         FROM monero_supply_checkpoints
        ORDER BY height DESC
        LIMIT 1`,
    ),
  ]);

  const stats = statsResult.rows[0];
  const latestSupply = supplyResult.rows[0] ? supplySummary(supplyResult.rows[0]) : null;
  const body = {
    total_blocks: Number(stats.total_blocks),
    total_transactions: Number(stats.total_transactions),
    settled_blocks: Number(stats.settled_blocks),
    latest_height: toNumber(stats.latest_height),
    latest_settled_height: toNumber(stats.latest_settled_height),
    last_indexed_height: progress.lastHeight,
    last_indexed_hash: progress.lastHash,
    node_height: info?.height ?? null,
    node_target_height: info?.target_height ?? null,
    node_synchronized: info?.synchronized ?? null,
    node_busy_syncing: info?.busy_syncing ?? null,
    node_pruned: pruneStatus?.pruned ?? null,
    lag_blocks: info ? Math.max(0, info.height - Math.max(progress.lastHeight, 0)) : null,
    settlement_depth: config.SETTLEMENT_DEPTH,
    latest_supply: latestSupply,
  };

  statsCache = { expiresAt: Date.now() + STATS_CACHE_MS, body };
  sendJson(res, 200, body);
}

async function handleBlocks(url: URL, res: http.ServerResponse): Promise<void> {
  const limit = parseLimit(url);
  const offset = parseOffset(url);
  const canonical = parseBooleanFilter(url, 'canonical', true);
  const settled = parseBooleanFilter(url, 'settled', null);
  const order = parseOrder(url);
  const direction = order === 'asc' ? 'ASC' : 'DESC';
  const values: unknown[] = [];
  const conditions: string[] = [];

  if (canonical !== null) {
    values.push(canonical);
    conditions.push(`is_canonical = $${values.length}`);
  }
  if (settled !== null) {
    values.push(settled);
    conditions.push(`is_settled = $${values.length}`);
  }

  values.push(limit + 1, offset);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitParam = values.length - 1;
  const offsetParam = values.length;

  const { rows } = await getPool().query<BlockApiRow>(
    `SELECT hash, prev_hash, height::text, timestamp::text, major_version, minor_version, nonce::text,
            block_size::text, block_weight::text, long_term_weight::text, num_txes, miner_tx_hash,
            reward_atomic, difficulty_hex, cumulative_difficulty_hex, orphan_status,
            is_canonical, is_settled, indexed_at, coinbase_extra_hex
       FROM monero_blocks
       ${where}
      ORDER BY height ${direction}, hash ${direction}
      LIMIT $${limitParam} OFFSET $${offsetParam}`,
    values,
  );

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  sendJson(res, 200, {
    data: pageRows.map(blockSummary),
    pagination: { limit, offset, order, has_more: hasMore },
  });
}

async function handleBlockById(id: string, res: http.ServerResponse): Promise<void> {
  const isHeightLookup = /^\d+$/.test(id);
  const query = isHeightLookup
    ? `SELECT hash, prev_hash, height::text, timestamp::text, major_version, minor_version, nonce::text,
              block_size::text, block_weight::text, long_term_weight::text, num_txes, miner_tx_hash,
              reward_atomic, difficulty_hex, cumulative_difficulty_hex, orphan_status,
              is_canonical, is_settled, indexed_at, raw, coinbase_extra_hex
         FROM monero_blocks
        WHERE height = $1
        ORDER BY CASE WHEN is_canonical THEN 0 ELSE 1 END, hash ASC
        LIMIT 1`
    : `SELECT hash, prev_hash, height::text, timestamp::text, major_version, minor_version, nonce::text,
              block_size::text, block_weight::text, long_term_weight::text, num_txes, miner_tx_hash,
              reward_atomic, difficulty_hex, cumulative_difficulty_hex, orphan_status,
              is_canonical, is_settled, indexed_at, raw, coinbase_extra_hex
         FROM monero_blocks
        WHERE hash = $1
        LIMIT 1`;

  const { rows } = await getPool().query<BlockApiRow>(query, [isHeightLookup ? Number(id) : id]);
  if (rows.length === 0) {
    sendNotFound(res);
    return;
  }

  const txResult = await getPool().query<TransactionApiRow>(
    `SELECT tx.hash, tx.block_hash, tx.block_height::text, tx.position, tx.version, tx.unlock_time::text,
            tx.is_coinbase, tx.inputs_count, tx.outputs_count, tx.extra_size, tx.fee_atomic, tx.size_bytes::text,
            tx.in_pool, tx.confirmations::text, tx.indexed_at, block.is_canonical, block.is_settled
       FROM monero_transactions tx
       JOIN monero_blocks block ON block.hash = tx.block_hash
      WHERE tx.block_hash = $1
      ORDER BY tx.position ASC`,
    [rows[0].hash],
  );

  sendJson(res, 200, {
    ...blockSummary(rows[0]),
    transactions: txResult.rows.map((row) => transactionSummary(row)),
    raw: rows[0].raw,
  });
}

async function handleTransactions(url: URL, res: http.ServerResponse): Promise<void> {
  const limit = parseLimit(url);
  const offset = parseOffset(url);
  const canonical = parseBooleanFilter(url, 'canonical', true);
  const settled = parseBooleanFilter(url, 'settled', null);
  const order = parseOrder(url);
  const blockHash = url.searchParams.get('block_hash');
  const direction = order === 'asc' ? 'ASC' : 'DESC';
  const values: unknown[] = [];
  const conditions: string[] = [];

  if (canonical !== null) {
    values.push(canonical);
    conditions.push(`block.is_canonical = $${values.length}`);
  }
  if (settled !== null) {
    values.push(settled);
    conditions.push(`block.is_settled = $${values.length}`);
  }
  if (blockHash) {
    values.push(blockHash);
    conditions.push(`tx.block_hash = $${values.length}`);
  }

  values.push(limit + 1, offset);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitParam = values.length - 1;
  const offsetParam = values.length;

  const { rows } = await getPool().query<TransactionApiRow>(
    `SELECT tx.hash, tx.block_hash, tx.block_height::text, tx.position, tx.version, tx.unlock_time::text,
           tx.is_coinbase, tx.inputs_count, tx.outputs_count, tx.extra_size, tx.fee_atomic, tx.size_bytes::text,
           tx.in_pool, tx.confirmations::text, tx.indexed_at, block.is_canonical, block.is_settled
       FROM monero_transactions tx
       JOIN monero_blocks block ON block.hash = tx.block_hash
       ${where}
      ORDER BY tx.block_height ${direction}, tx.position ${direction}, tx.hash ${direction}
      LIMIT $${limitParam} OFFSET $${offsetParam}`,
    values,
  );

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  sendJson(res, 200, {
    data: pageRows.map((row) => transactionSummary(row)),
    pagination: { limit, offset, order, has_more: hasMore },
  });
}

async function handleTransactionById(id: string, res: http.ServerResponse): Promise<void> {
  const { rows } = await getPool().query<TransactionApiRow>(
    `SELECT tx.hash, tx.block_hash, tx.block_height::text, tx.position, tx.version, tx.unlock_time::text,
            tx.is_coinbase, tx.inputs_count, tx.outputs_count, tx.extra_size, tx.fee_atomic, tx.size_bytes::text,
            tx.in_pool, tx.confirmations::text, tx.indexed_at, block.is_canonical, block.is_settled
       FROM monero_transactions tx
       JOIN monero_blocks block ON block.hash = tx.block_hash
      WHERE tx.hash = $1
      ORDER BY CASE WHEN block.is_canonical THEN 0 ELSE 1 END
      LIMIT 1`,
    [id],
  );

  if (rows.length === 0) {
    sendNotFound(res);
    return;
  }

  const fetched = await fetchTransactions([id], 60_000, 2);
  const rpcTx = fetched.find((tx) => tx.tx_hash === id) ?? null;
  const raw = rpcTx
    ? {
        ...rpcTx,
        parsed_json: parseMoneroJson<MoneroTxJson>(rpcTx.as_json),
      }
    : null;

  sendJson(res, 200, {
    ...transactionSummary(rows[0], raw),
    raw_source: raw ? 'monerod' : null,
  });
}

async function handleSupply(url: URL, res: http.ServerResponse): Promise<void> {
  const limit = parseLimit(url);
  const offset = parseOffset(url);
  const order = parseOrder(url);
  const direction = order === 'asc' ? 'ASC' : 'DESC';

  const { rows } = await getPool().query<SupplyApiRow>(
    `SELECT height::text, block_hash, block_timestamp::text, cumulative_emission_atomic,
            cumulative_fee_atomic, source_method, computed_at
       FROM monero_supply_checkpoints
      ORDER BY height ${direction}
      LIMIT $1 OFFSET $2`,
    [limit + 1, offset],
  );

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  sendJson(res, 200, {
    data: pageRows.map(supplySummary),
    pagination: { limit, offset, order, has_more: hasMore },
  });
}

async function route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method !== 'GET') {
    sendMethodNotAllowed(res);
    return;
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const routeParts = parts[0] === 'api' && parts[1] === 'v1'
    ? ['api', ...parts.slice(2)]
    : parts;

  if (url.pathname === '/health') {
    await handleHealth(res);
    return;
  }

  if (url.pathname === '/metrics') {
    await handleMetrics(res);
    return;
  }

  if (url.pathname === '/openapi.json') {
    sendJson(res, 200, getOpenApiDocument());
    return;
  }

  if (url.pathname === '/docs') {
    sendHtml(res, swaggerHtml());
    return;
  }

  if (routeParts[0] !== 'api') {
    sendNotFound(res);
    return;
  }

  if (routeParts.length === 2 && routeParts[1] === 'stats') {
    await handleStats(res);
    return;
  }

  if (routeParts.length === 2 && routeParts[1] === 'blocks') {
    await handleBlocks(url, res);
    return;
  }

  if (routeParts.length === 3 && routeParts[1] === 'blocks') {
    await handleBlockById(routeParts[2], res);
    return;
  }

  if (routeParts.length === 2 && routeParts[1] === 'transactions') {
    await handleTransactions(url, res);
    return;
  }

  if (routeParts.length === 3 && routeParts[1] === 'transactions') {
    await handleTransactionById(routeParts[2], res);
    return;
  }

  if (routeParts.length === 2 && routeParts[1] === 'supply') {
    await handleSupply(url, res);
    return;
  }

  sendNotFound(res);
}

export function startApiServer(): () => void {
  const server = http.createServer((req, res) => {
    route(req, res).catch((err) => {
      logger.error('API request failed', { err });
      sendJson(res, 500, { error: 'internal_server_error' });
    });
  });

  server.listen(config.API_PORT, config.API_BIND, () => {
    logger.info('Monero explorer API listening', {
      host: config.API_BIND,
      port: config.API_PORT,
    });
  });

  return () => { server.close(); };
}

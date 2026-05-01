import http from 'node:http';
import { getPool } from './db/pg.js';
import { getLastSlot } from './db/progress.js';
import { fetchInfo } from './rpc/client.js';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { metricsContentType, metricsText } from './metrics/registry.js';

const startedAt = Date.now();
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const STATS_CACHE_MS = 5_000;

interface BlockApiRow {
  id: string;
  parent_block: string;
  slot: string;
  height: string | null;
  block_root: string;
  leader_key: string;
  voucher_cm: string;
  entropy: string;
  tx_count: number;
  finalized: boolean;
  indexed_at: Date;
}

interface BlockDetailApiRow extends BlockApiRow {
  raw: unknown;
}

interface LeaderKeyApiRow {
  leader_key: string;
  blocks_produced: string;
  first_block_slot: string | null;
  last_block_slot: string | null;
  updated_at: Date;
}

interface StatsApiRow {
  total_blocks: string;
  finalized_blocks: string;
  latest_slot: string | null;
  latest_height: string | null;
  leader_keys_count: string;
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

function parseFinalized(url: URL): boolean | null {
  const value = url.searchParams.get('finalized') ?? 'true';
  if (value === 'all') return null;
  return value !== 'false';
}

function toNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
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

async function fetchInfoQuick(): Promise<Awaited<ReturnType<typeof fetchInfo>> | null> {
  return withTimeout(fetchInfo(4_000, 1), 4_500).catch(() => null);
}

function blockSummary(row: BlockApiRow): Record<string, unknown> {
  return {
    id: row.id,
    parent_block: row.parent_block,
    slot: Number(row.slot),
    height: toNumber(row.height),
    block_root: row.block_root,
    leader_key: row.leader_key,
    voucher_cm: row.voucher_cm,
    entropy: row.entropy,
    tx_count: row.tx_count,
    finalized: row.finalized,
    indexed_at: row.indexed_at,
  };
}

function leaderKeySummary(row: LeaderKeyApiRow): Record<string, unknown> {
  return {
    leader_key: row.leader_key,
    blocks_with_key: Number(row.blocks_produced),
    first_seen_slot: toNumber(row.first_block_slot),
    last_seen_slot: toNumber(row.last_block_slot),
    stable_validator_identity: false,
    identity_scope: 'proof_of_leadership.leader_key',
    updated_at: row.updated_at,
  };
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function sendNotFound(res: http.ServerResponse): void {
  sendJson(res, 404, { error: 'not_found' });
}

function sendMethodNotAllowed(res: http.ServerResponse): void {
  sendJson(res, 405, { error: 'method_not_allowed' });
}

function sendValidatorIdentityUnavailable(res: http.ServerResponse): void {
  sendJson(res, 410, {
    error: 'validator_identity_unavailable',
    message: 'Logos v0.1.2 block headers expose proof_of_leadership.leader_key, not a stable validator identity. Use /api/v1/leader-keys for proof-key diagnostics.',
  });
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
    const [lastSlot, info] = await Promise.all([
      getLastSlot(),
      fetchInfoQuick(),
    ]);

    const lagSlots = info ? Math.max(0, info.slot - lastSlot) : null;
    const healthy = info !== null;

    sendJson(res, healthy ? 200 : 503, {
      status: healthy ? 'ok' : 'degraded',
      last_slot: lastSlot,
      node_tip_slot: info?.slot ?? null,
      node_height: info?.height ?? null,
      node_mode: info?.mode ?? null,
      lag_slots: lagSlots,
      uptime_s: Math.floor((Date.now() - startedAt) / 1_000),
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
  const [statsResult, progressResult, nodeInfo] = await Promise.all([
    pool.query<StatsApiRow>(
      `SELECT
         COUNT(*)::text AS total_blocks,
         COUNT(*) FILTER (WHERE finalized)::text AS finalized_blocks,
         MAX(slot)::text AS latest_slot,
         MAX(height)::text AS latest_height,
         (SELECT COUNT(*)::text FROM logos_leaders) AS leader_keys_count
       FROM logos_blocks`,
    ),
    getLastSlot(),
    fetchInfoQuick(),
  ]);

  const stats = statsResult.rows[0];
  const body = {
    total_blocks: Number(stats.total_blocks),
    finalized_blocks: Number(stats.finalized_blocks),
    latest_slot: toNumber(stats.latest_slot),
    latest_height: toNumber(stats.latest_height),
    leader_keys_count: Number(stats.leader_keys_count),
    last_indexed_slot: progressResult,
    node_tip_slot: nodeInfo?.slot ?? null,
    node_height: nodeInfo?.height ?? null,
    node_mode: nodeInfo?.mode ?? null,
    lag_slots: nodeInfo ? Math.max(0, nodeInfo.slot - progressResult) : null,
  };

  statsCache = { expiresAt: Date.now() + STATS_CACHE_MS, body };
  sendJson(res, 200, body);
}

async function handleBlocks(url: URL, res: http.ServerResponse): Promise<void> {
  const limit = parseLimit(url);
  const offset = parseOffset(url);
  const finalized = parseFinalized(url);
  const leaderKey = url.searchParams.get('leader_key');
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (finalized !== null) {
    values.push(finalized);
    conditions.push(`finalized = $${values.length}`);
  }
  if (leaderKey) {
    values.push(leaderKey);
    conditions.push(`leader_key = $${values.length}`);
  }

  values.push(limit + 1, offset);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitParam = values.length - 1;
  const offsetParam = values.length;

  const pool = getPool();
  const { rows } = await pool.query<BlockApiRow>(
    `SELECT id, parent_block, slot::text, height::text, block_root, leader_key,
            voucher_cm, entropy, tx_count, finalized, indexed_at
       FROM logos_blocks
       ${where}
       ORDER BY slot DESC, id DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
    values,
  );

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  sendJson(res, 200, {
    data: pageRows.map(blockSummary),
    pagination: {
      limit,
      offset,
      has_more: hasMore,
    },
  });
}

async function handleBlockById(id: string, res: http.ServerResponse): Promise<void> {
  const { rows } = await getPool().query<BlockDetailApiRow>(
    `SELECT id, parent_block, slot::text, height::text, block_root, leader_key,
            voucher_cm, entropy, tx_count, finalized, indexed_at, raw
       FROM logos_blocks
       WHERE id = $1`,
    [id],
  );

  if (rows.length === 0) {
    sendNotFound(res);
    return;
  }

  sendJson(res, 200, {
    ...blockSummary(rows[0]),
    raw: rows[0].raw,
  });
}

async function handleLeaderKeys(url: URL, res: http.ServerResponse): Promise<void> {
  const limit = parseLimit(url);
  const offset = parseOffset(url);
  const pool = getPool();
  const [leaderKeysResult, countResult] = await Promise.all([
    pool.query<LeaderKeyApiRow>(
      `SELECT leader_key, blocks_produced::text, first_block_slot::text,
              last_block_slot::text, updated_at
         FROM logos_leaders
         ORDER BY blocks_produced DESC, leader_key ASC
         LIMIT $1 OFFSET $2`,
      [limit, offset],
    ),
    pool.query<{ total: string }>('SELECT COUNT(*)::text AS total FROM logos_leaders'),
  ]);

  const total = Number(countResult.rows[0].total);

  sendJson(res, 200, {
    data: leaderKeysResult.rows.map(leaderKeySummary),
    pagination: {
      limit,
      offset,
      total,
      has_more: offset + leaderKeysResult.rows.length < total,
    },
  });
}

async function handleLeaderKey(leaderKey: string, res: http.ServerResponse): Promise<void> {
  const { rows } = await getPool().query<LeaderKeyApiRow>(
    `SELECT leader_key, blocks_produced::text, first_block_slot::text,
            last_block_slot::text, updated_at
       FROM logos_leaders
       WHERE leader_key = $1`,
    [leaderKey],
  );

  if (rows.length === 0) {
    sendNotFound(res);
    return;
  }

  sendJson(res, 200, leaderKeySummary(rows[0]));
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

  if (routeParts[1] === 'validators') {
    sendValidatorIdentityUnavailable(res);
    return;
  }

  if (routeParts.length === 2 && routeParts[1] === 'leader-keys') {
    await handleLeaderKeys(url, res);
    return;
  }

  if (routeParts.length === 3 && routeParts[1] === 'leader-keys') {
    await handleLeaderKey(routeParts[2], res);
    return;
  }

  if (routeParts.length === 4 && routeParts[1] === 'leader-keys' && routeParts[3] === 'blocks') {
    url.searchParams.set('leader_key', routeParts[2]);
    await handleBlocks(url, res);
    return;
  }

  sendNotFound(res);
}

/**
 * Start the explorer API server on API_BIND:API_PORT (default: 0.0.0.0:3001).
 *
 * Endpoints:
 *   GET /health
 *   GET /metrics
 *   GET /api/stats
 *   GET /api/v1/stats
 *   GET /api/blocks?limit=20&offset=0&finalized=true|false|all
 *   GET /api/blocks/:id
 *   GET /api/leader-keys?limit=20&offset=0
 *   GET /api/leader-keys/:leader_key
 *   GET /api/leader-keys/:leader_key/blocks
 */
export function startApiServer(): () => void {
  const server = http.createServer((req, res) => {
    route(req, res).catch((err) => {
      logger.error('API request failed', { err });
      sendJson(res, 500, { error: 'internal_server_error' });
    });
  });

  server.listen(config.API_PORT, config.API_BIND, () => {
    logger.info('Explorer API server listening', {
      host: config.API_BIND,
      port: config.API_PORT,
    });
  });

  return () => { server.close(); };
}

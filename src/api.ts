import http from 'node:http';
import { bech32m } from 'bech32';
import { config } from './config.js';
import { getPool } from './db/pg.js';
import { metricsContentType, metricsText } from './metrics/registry.js';
import { logger } from './utils/logger.js';

const startedAt = Date.now();
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_OFFSET = 100_000;
const JSON_BODY_LIMIT_BYTES = 100 * 1024;
const API_VERSION = '0.0.1';
const HEX_RE = /^[0-9a-fA-F]+$/;
const STATS_CACHE_TTL_MS = 5_000;
const COUNT_CACHE_TTL_MS = 5_000;
const ACCOUNT_ID_BYTES = 15;
const ACCOUNT_ID_HEX_LENGTH = ACCOUNT_ID_BYTES * 2;
const ACCOUNT_ID_BECH32_HRP = 'miden';

let statsCache: { value: unknown; expiresAt: number } | null = null;
const countCache = new Map<string, { value: string; expiresAt: number }>();

async function cachedCount(
  table: string,
  whereSql: string,
  values: readonly unknown[],
): Promise<string> {
  const key = `${table}::${whereSql}::${JSON.stringify(values)}`;
  const now = Date.now();
  const hit = countCache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;
  const { rows } = await getPool().query<CountRow>(
    `SELECT COUNT(*)::text AS total FROM ${table} ${whereSql}`,
    values as unknown[],
  );
  const value = rows[0]?.total ?? '0';
  countCache.set(key, { value, expiresAt: now + COUNT_CACHE_TTL_MS });
  if (countCache.size > 256) {
    for (const [k, v] of countCache) {
      if (v.expiresAt <= now) countCache.delete(k);
    }
  }
  return value;
}

type ChainTipGetter = () => number | null;

type TextArray = string[] | null;

interface ApiServerOptions {
  getChainTip?: ChainTipGetter;
}

type ApiServerArgument = ApiServerOptions | ChainTipGetter;

interface PageParams {
  limit: number;
  offset: number;
}

interface BlockListParams extends PageParams {
  order: 'asc' | 'desc';
}

interface QueryParts {
  where: string;
  values: unknown[];
}

interface CountRow {
  total: string;
}

interface ProgressRow {
  last_block: string;
}

interface HealthBlockRow {
  last_block: string | null;
}

interface StatsRow {
  last_block: string;
  total_blocks: string;
  total_transactions: string;
  total_notes: string;
  total_nullifiers: string;
  total_accounts: string;
  latest_block_timestamp: Date | null;
  tps: number;
}

interface BlockSummaryRow {
  block_num: string;
  block_hash: string;
  block_commitment: string | null;
  prev_block_commitment: string;
  chain_commitment: string;
  account_root: string;
  nullifier_root: string;
  note_root: string;
  tx_commitment: string;
  validator_key: string;
  tx_kernel_commitment: string;
  native_asset_id: string;
  verification_base_fee: string;
  timestamp: Date;
  tx_count: number;
  note_count: number;
  nullifier_count: number;
  version: number | null;
  chain_length: string | null;
  inserted_at: Date;
}

interface BlockDetailRow extends BlockSummaryRow {
  raw_block_bytes: string | null;
}

interface TransactionRow {
  tx_id: string;
  block_num: string;
  account_id: string;
  init_account_state: string | null;
  final_account_state: string | null;
  input_notes_commitment: string | null;
  output_notes_commitment: string | null;
  expiration_block_num: string | null;
  input_nullifiers: TextArray;
  output_note_ids: TextArray;
  block_timestamp: Date | null;
  inserted_at: Date;
}

interface NoteRow {
  note_id: string;
  block_num: string;
  note_index: number;
  is_public: boolean;
  metadata: string;
  sender: string | null;
  tag: string | null;
  note_type: number | null;
  attachment: string | null;
  aux: string | null;
  execution_hint: string | null;
  recipient_digest: string | null;
  assets: string | null;
  script_root: string | null;
  inputs_hash: string | null;
  serial_num: string | null;
  note_details: string | null;
  inserted_at: Date;
}

interface NullifierRow {
  nullifier: string;
  block_num: string;
  consumed_note_id: string | null;
  inserted_at: Date;
}

interface AccountRow {
  account_id: string;
  is_public: boolean;
  last_block_num: string;
  account_commitment: string;
  nonce: string | null;
  code_commitment: string | null;
  storage_commitment: string | null;
  vault_root: string | null;
  account_type: number | null;
  storage_mode: number | null;
  updated_at: Date;
}

interface ApiErrorBody {
  error: string;
  code: string;
}

type SearchType = 'tx' | 'block' | 'note' | 'nullifier' | 'account' | 'ambiguous' | 'not_found';

class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, error: string, code: string) {
    super(error);
    this.status = status;
    this.code = code;
  }
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(body));
}

function errorBody(error: string, code: string): ApiErrorBody {
  return { error, code };
}

function sendError(res: http.ServerResponse, err: unknown): void {
  const httpErr = err instanceof HttpError
    ? err
    : new HttpError(500, 'internal server error', 'INTERNAL_SERVER_ERROR');

  const logMeta = { status: httpErr.status, code: httpErr.code, message: httpErr.message };
  if (httpErr.status >= 500) {
    logger.error('API request failed', logMeta);
  } else {
    logger.warn('API request rejected', logMeta);
  }

  sendJson(res, httpErr.status, errorBody(httpErr.message, httpErr.code));
}

function parseIntegerParam(name: string, value: string | null, required: boolean): number | null {
  if (value === null || value === '') {
    if (required) throw new HttpError(400, `invalid ${name}`, 'INVALID_NUMERIC');
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) throw new HttpError(400, `invalid ${name}`, 'INVALID_NUMERIC');
  return parsed;
}

function parsePage(url: URL): PageParams {
  const parsedLimit = parseIntegerParam('limit', url.searchParams.get('limit'), false) ?? DEFAULT_LIMIT;
  const parsedOffset = parseIntegerParam('offset', url.searchParams.get('offset'), false) ?? 0;
  if (parsedOffset < 0) throw new HttpError(400, 'invalid offset', 'INVALID_NUMERIC');
  if (parsedOffset > MAX_OFFSET) {
    throw new HttpError(400, `offset exceeds MAX_OFFSET=${MAX_OFFSET}; use a narrower filter`, 'OFFSET_TOO_LARGE');
  }
  return {
    limit: Math.min(Math.max(parsedLimit, 1), MAX_LIMIT),
    offset: parsedOffset,
  };
}

function parseBlockListParams(url: URL): BlockListParams {
  const page = parsePage(url);
  const orderValue = url.searchParams.get('order') ?? 'desc';
  if (orderValue !== 'asc' && orderValue !== 'desc') {
    throw new HttpError(400, 'invalid order', 'INVALID_ORDER');
  }
  return { ...page, order: orderValue };
}

function parseBooleanParam(name: string, value: string | null): boolean | null {
  if (value === null || value === '') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new HttpError(400, `invalid ${name}`, 'INVALID_BOOLEAN');
}

function parseHexParam(hex: string, expectedBytes: number | null = null): Buffer {
  if (!HEX_RE.test(hex) || hex.length % 2 !== 0 || (expectedBytes !== null && hex.length !== expectedBytes * 2)) {
    throw new HttpError(400, 'invalid hex', 'INVALID_HEX');
  }
  return Buffer.from(hex, 'hex');
}

function addCondition(parts: QueryParts, sql: string, value: unknown): void {
  parts.values.push(value);
  parts.where = parts.where
    ? `${parts.where} AND ${sql.replace('?', `$${parts.values.length}`)}`
    : `WHERE ${sql.replace('?', `$${parts.values.length}`)}`;
}

function parseSafeApiInteger(value: string, field: string): number {
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`invalid integer value for ${field}: ${value}`);
  }
  if (parsed < 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`integer value for ${field} is out of safe JSON range: ${value}`);
  }
  return Number(parsed);
}

function parseOptionalSafeApiInteger(value: string | null, field: string): number | null {
  return value === null ? null : parseSafeApiInteger(value, field);
}

function accountIdToBech32(hexId: string): string | null {
  if (!HEX_RE.test(hexId) || hexId.length !== ACCOUNT_ID_HEX_LENGTH) return null;
  try {
    const bytes = Buffer.from(hexId, 'hex');
    if (bytes.length !== ACCOUNT_ID_BYTES) return null;
    return bech32m.encode(ACCOUNT_ID_BECH32_HRP, bech32m.toWords(bytes));
  } catch {
    return null;
  }
}

function blockSummaryResponse(row: BlockSummaryRow): Record<string, unknown> {
  return {
    ...row,
    block_num: parseSafeApiInteger(row.block_num, 'block_num'),
    chain_length: parseOptionalSafeApiInteger(row.chain_length, 'chain_length'),
    proof_commitment: row.tx_kernel_commitment,
  };
}

function blockDetailResponse(row: BlockDetailRow): Record<string, unknown> {
  return {
    ...blockSummaryResponse(row),
    raw_block_bytes: row.raw_block_bytes,
  };
}

function transactionResponse(row: TransactionRow): Record<string, unknown> {
  return {
    ...row,
    account_id_bech32: accountIdToBech32(row.account_id),
    block_num: parseSafeApiInteger(row.block_num, 'block_num'),
    expiration_block_num: parseOptionalSafeApiInteger(row.expiration_block_num, 'expiration_block_num'),
    block_timestamp: row.block_timestamp ?? null,
  };
}

function noteResponse(row: NoteRow): Record<string, unknown> {
  return {
    ...row,
    block_num: parseSafeApiInteger(row.block_num, 'block_num'),
  };
}

function nullifierResponse(row: NullifierRow): Record<string, unknown> {
  return {
    ...row,
    block_num: parseSafeApiInteger(row.block_num, 'block_num'),
  };
}

function accountResponse(row: AccountRow): Record<string, unknown> {
  return {
    ...row,
    account_id_bech32: accountIdToBech32(row.account_id),
    last_block_num: parseSafeApiInteger(row.last_block_num, 'last_block_num'),
  };
}

function paginated<T>(rows: T[], total: string, page: PageParams): Record<string, unknown> {
  return {
    data: rows,
    total: Number(total),
    limit: page.limit,
    offset: page.offset,
  };
}

const blockSummaryColumns = `
  miden_blocks.block_num::text,
  encode(block_hash, 'hex') AS block_hash,
  (
    SELECT encode(successor.prev_block_commitment, 'hex')
    FROM miden_blocks successor
    WHERE successor.block_num = miden_blocks.block_num + 1
  ) AS block_commitment,
  encode(prev_block_commitment, 'hex') AS prev_block_commitment,
  encode(chain_commitment, 'hex') AS chain_commitment,
  encode(account_root, 'hex') AS account_root,
  encode(nullifier_root, 'hex') AS nullifier_root,
  encode(note_root, 'hex') AS note_root,
  encode(tx_commitment, 'hex') AS tx_commitment,
  encode(validator_key, 'hex') AS validator_key,
  encode(tx_kernel_commitment, 'hex') AS tx_kernel_commitment,
  encode(native_asset_id, 'hex') AS native_asset_id,
  verification_base_fee::text,
  timestamp,
  tx_count,
  note_count,
  nullifier_count,
  version,
  chain_length::text,
  inserted_at`;

const transactionColumns = `
  encode(tx_id, 'hex') AS tx_id,
  miden_transactions.block_num::text,
  encode(account_id, 'hex') AS account_id,
  encode(init_account_state, 'hex') AS init_account_state,
  encode(final_account_state, 'hex') AS final_account_state,
  encode(input_notes_commitment, 'hex') AS input_notes_commitment,
  encode(output_notes_commitment, 'hex') AS output_notes_commitment,
  expiration_block_num::text,
  CASE WHEN input_nullifiers IS NULL THEN NULL ELSE ARRAY(SELECT encode(x, 'hex') FROM unnest(input_nullifiers) AS x) END AS input_nullifiers,
  CASE WHEN output_note_ids IS NULL THEN NULL ELSE ARRAY(SELECT encode(x, 'hex') FROM unnest(output_note_ids) AS x) END AS output_note_ids,
  b.timestamp AS block_timestamp,
  miden_transactions.inserted_at`;

const transactionJoin = `LEFT JOIN miden_blocks b ON miden_transactions.block_num = b.block_num`;

const noteColumns = `
  encode(note_id, 'hex') AS note_id,
  block_num::text,
  note_index,
  is_public,
  encode(metadata, 'hex') AS metadata,
  encode(sender, 'hex') AS sender,
  tag::text,
  note_type,
  encode(attachment, 'hex') AS attachment,
  aux::text,
  execution_hint::text,
  encode(recipient_digest, 'hex') AS recipient_digest,
  encode(assets, 'hex') AS assets,
  encode(script_root, 'hex') AS script_root,
  encode(inputs_hash, 'hex') AS inputs_hash,
  encode(serial_num, 'hex') AS serial_num,
  encode(note_details, 'hex') AS note_details,
  inserted_at`;

const nullifierColumns = `
  encode(nullifier, 'hex') AS nullifier,
  block_num::text,
  encode(consumed_note_id, 'hex') AS consumed_note_id,
  inserted_at`;

const accountColumns = `
  encode(account_id, 'hex') AS account_id,
  is_public,
  last_block_num::text,
  encode(account_commitment, 'hex') AS account_commitment,
  nonce::text,
  encode(code_commitment, 'hex') AS code_commitment,
  encode(storage_commitment, 'hex') AS storage_commitment,
  encode(vault_root, 'hex') AS vault_root,
  account_type,
  storage_mode,
  updated_at`;

async function handleHealth(res: http.ServerResponse, getChainTip?: ChainTipGetter): Promise<void> {
  const pool = getPool();
  try {
    await pool.query('SELECT 1');
  } catch {
    throw new HttpError(503, 'database unavailable', 'DATABASE_UNAVAILABLE');
  }

  const { rows } = await pool.query<HealthBlockRow>(
    `SELECT GREATEST(
       (SELECT last_block FROM miden_indexer_progress WHERE id = 1),
       (SELECT MAX(block_num) FROM miden_blocks)
     )::text AS last_block`,
  );
  const lastBlock = rows[0]?.last_block ?? null;
  const chainTip = getChainTip?.() ?? null;
  const lagBlocks = chainTip !== null && lastBlock !== null
    ? Math.max(0, chainTip - Number(BigInt(lastBlock)))
    : null;

  sendJson(res, 200, {
    ok: true,
    lag_blocks: lagBlocks,
    last_block: parseOptionalSafeApiInteger(lastBlock, 'last_block'),
    uptime_s: Math.floor((Date.now() - startedAt) / 1_000),
    version: API_VERSION,
  });
}

async function handleStats(res: http.ServerResponse): Promise<void> {
  if (statsCache && statsCache.expiresAt > Date.now()) {
    sendJson(res, 200, statsCache.value);
    return;
  }
  const { rows } = await getPool().query<StatsRow>(
    `SELECT
       (SELECT last_block::text FROM miden_indexer_progress WHERE id = 1) AS last_block,
       COUNT(*)::text AS total_blocks,
       -- TODO(perf): switch exact counts to maintained counters if data volume grows.
       (SELECT COUNT(*)::text FROM miden_transactions) AS total_transactions,
        (SELECT COUNT(*)::text FROM miden_notes) AS total_notes,
        (SELECT COUNT(*)::text FROM miden_nullifiers) AS total_nullifiers,
        (SELECT COUNT(*)::text FROM miden_accounts) AS total_accounts,
        MAX(timestamp) AS latest_block_timestamp,
        (
          SELECT ROUND(
            COUNT(*)::numeric / 60.0,
            4
          )::float
          FROM miden_transactions
          WHERE inserted_at >= now() - interval '60 seconds'
        ) AS tps
      FROM miden_blocks`,
  );
  const stats = rows[0];
  const payload = {
    last_block: parseSafeApiInteger(stats.last_block, 'last_block'),
    total_blocks: Number(stats.total_blocks),
    total_transactions: Number(stats.total_transactions),
    total_notes: Number(stats.total_notes),
    total_nullifiers: Number(stats.total_nullifiers),
    total_accounts: Number(stats.total_accounts),
    latest_block_timestamp: stats.latest_block_timestamp,
    tps: stats.tps,
  };
  statsCache = { value: payload, expiresAt: Date.now() + STATS_CACHE_TTL_MS };
  sendJson(res, 200, payload);
}

async function handleBlocks(url: URL, res: http.ServerResponse): Promise<void> {
  const page = parseBlockListParams(url);
  const values: unknown[] = [page.limit, page.offset];
  const [blocks, total] = await Promise.all([
    getPool().query<BlockSummaryRow>(
      `SELECT ${blockSummaryColumns}
       FROM miden_blocks
        ORDER BY miden_blocks.block_num ${page.order === 'asc' ? 'ASC' : 'DESC'}
        LIMIT $1 OFFSET $2`,
      values,
    ),
    cachedCount('miden_blocks', '', []),
  ]);
  sendJson(res, 200, paginated(blocks.rows.map(blockSummaryResponse), total, page));
}

async function handleBlockByNumber(blockNum: string, url: URL, res: http.ServerResponse): Promise<void> {
  const parsed = parseIntegerParam('block_num', blockNum, true);
  if (parsed === null || parsed < 0) throw new HttpError(400, 'invalid block_num', 'INVALID_NUMERIC');
  const includeRaw = parseBooleanParam('include_raw', url.searchParams.get('include_raw')) === true;
  const projection = includeRaw
    ? `${blockSummaryColumns}, encode(raw_block_bytes, 'hex') AS raw_block_bytes`
    : blockSummaryColumns;
  const { rows } = await getPool().query<BlockDetailRow>(
    `SELECT ${projection}
     FROM miden_blocks
     WHERE block_num = $1`,
    [parsed],
  );
  if (rows.length === 0) throw new HttpError(404, 'not found', 'NOT_FOUND');
  sendJson(res, 200, blockDetailResponse(rows[0]));
}

async function handleBlockByHash(hex: string, url: URL, res: http.ServerResponse): Promise<void> {
  const hash = parseHexParam(hex, 32);
  const includeRaw = parseBooleanParam('include_raw', url.searchParams.get('include_raw')) === true;
  const projection = includeRaw
    ? `${blockSummaryColumns}, encode(raw_block_bytes, 'hex') AS raw_block_bytes`
    : blockSummaryColumns;
  const { rows } = await getPool().query<BlockDetailRow>(
    `SELECT ${projection}
     FROM miden_blocks
     WHERE block_hash = $1`,
    [hash],
  );
  if (rows.length === 0) throw new HttpError(404, 'not found', 'NOT_FOUND');
  sendJson(res, 200, blockDetailResponse(rows[0]));
}

async function handleBlockTransactions(blockNumStr: string, url: URL, res: http.ServerResponse): Promise<void> {
  const blockNum = parseIntegerParam('block_num', blockNumStr, true);
  if (blockNum === null || blockNum < 0) throw new HttpError(400, 'invalid block_num', 'INVALID_NUMERIC');
  const page = parsePage(url);
  const [items, total] = await Promise.all([
    getPool().query<TransactionRow>(
      `SELECT ${transactionColumns}
       FROM miden_transactions
       ${transactionJoin}
       WHERE miden_transactions.block_num = $1
       ORDER BY tx_id ASC
       LIMIT $2 OFFSET $3`,
      [blockNum, page.limit, page.offset],
    ),
    cachedCount('miden_transactions', 'WHERE block_num = $1', [blockNum]),
  ]);
  sendJson(res, 200, paginated(items.rows.map(transactionResponse), total, page));
}

function transactionFilters(url: URL): QueryParts {
  const parts: QueryParts = { where: '', values: [] };
  const blockNum = parseIntegerParam('block_num', url.searchParams.get('block_num'), false);
  if (blockNum !== null) addCondition(parts, 'block_num = ?', blockNum);
  const accountId = url.searchParams.get('account_id');
  if (accountId !== null && accountId !== '') addCondition(parts, 'account_id = ?', parseHexParam(accountId, 15));
  return parts;
}

async function handleTransactions(url: URL, res: http.ServerResponse): Promise<void> {
  const page = parsePage(url);
  const filters = transactionFilters(url);
  const limitParam = filters.values.length + 1;
  const offsetParam = filters.values.length + 2;
  const values = [...filters.values, page.limit, page.offset];
  const [items, total] = await Promise.all([
    getPool().query<TransactionRow>(
      `SELECT ${transactionColumns}
       FROM miden_transactions
       ${transactionJoin}
       ${filters.where}
       ORDER BY miden_transactions.block_num DESC, tx_id ASC
        LIMIT $${limitParam} OFFSET $${offsetParam}`,
      values,
    ),
    cachedCount('miden_transactions', filters.where, filters.values),
  ]);
  sendJson(res, 200, paginated(items.rows.map(transactionResponse), total, page));
}

async function handleTransaction(hex: string, res: http.ServerResponse): Promise<void> {
  const txId = parseHexParam(hex, 32);
  const { rows } = await getPool().query<TransactionRow>(
     `SELECT ${transactionColumns}
      FROM miden_transactions
      ${transactionJoin}
      WHERE tx_id = $1`,
     [txId],
   );
  if (rows.length === 0) throw new HttpError(404, 'not found', 'NOT_FOUND');
  sendJson(res, 200, transactionResponse(rows[0]));
}

function noteFilters(url: URL): QueryParts {
  const parts: QueryParts = { where: '', values: [] };
  const blockNum = parseIntegerParam('block_num', url.searchParams.get('block_num'), false);
  if (blockNum !== null) addCondition(parts, 'block_num = ?', blockNum);
  const senderHex = url.searchParams.get('sender_hex');
  if (senderHex !== null && senderHex !== '') addCondition(parts, 'sender = ?', parseHexParam(senderHex, 15));
  const tag = parseIntegerParam('tag', url.searchParams.get('tag'), false);
  if (tag !== null) addCondition(parts, 'tag = ?', tag);
  const isPublic = parseBooleanParam('is_public', url.searchParams.get('is_public'));
  if (isPublic !== null) addCondition(parts, 'is_public = ?', isPublic);
  return parts;
}

async function handleNotes(url: URL, res: http.ServerResponse): Promise<void> {
  const page = parsePage(url);
  const filters = noteFilters(url);
  const limitParam = filters.values.length + 1;
  const offsetParam = filters.values.length + 2;
  const values = [...filters.values, page.limit, page.offset];
  const [items, total] = await Promise.all([
    getPool().query<NoteRow>(
      `SELECT ${noteColumns}
       FROM miden_notes
       ${filters.where}
       ORDER BY miden_notes.block_num DESC, note_index ASC, note_id ASC
        LIMIT $${limitParam} OFFSET $${offsetParam}`,
      values,
    ),
    cachedCount('miden_notes', filters.where, filters.values),
  ]);
  sendJson(res, 200, paginated(items.rows.map(noteResponse), total, page));
}

async function handleNote(hex: string, res: http.ServerResponse): Promise<void> {
  const noteId = parseHexParam(hex, 32);
  const { rows } = await getPool().query<NoteRow>(
     `SELECT ${noteColumns} FROM miden_notes WHERE note_id = $1`,
     [noteId],
   );
  if (rows.length === 0) throw new HttpError(404, 'not found', 'NOT_FOUND');
  sendJson(res, 200, noteResponse(rows[0]));
}

async function handleBlockNotes(blockNumStr: string, url: URL, res: http.ServerResponse): Promise<void> {
  const blockNum = parseIntegerParam('block_num', blockNumStr, true);
  if (blockNum === null || blockNum < 0) throw new HttpError(400, 'invalid block_num', 'INVALID_NUMERIC');
  const page = parsePage(url);
  const [items, total] = await Promise.all([
    getPool().query<NoteRow>(
      `SELECT ${noteColumns}
       FROM miden_notes
       WHERE block_num = $1
       ORDER BY note_index ASC, note_id ASC
       LIMIT $2 OFFSET $3`,
      [blockNum, page.limit, page.offset],
    ),
    cachedCount('miden_notes', 'WHERE block_num = $1', [blockNum]),
  ]);
  sendJson(res, 200, paginated(items.rows.map(noteResponse), total, page));
}

function nullifierFilters(url: URL): QueryParts {
  const parts: QueryParts = { where: '', values: [] };
  const blockNum = parseIntegerParam('block_num', url.searchParams.get('block_num'), false);
  if (blockNum !== null) addCondition(parts, 'block_num = ?', blockNum);
  return parts;
}

async function handleNullifiers(url: URL, res: http.ServerResponse): Promise<void> {
  const page = parsePage(url);
  const filters = nullifierFilters(url);
  const limitParam = filters.values.length + 1;
  const offsetParam = filters.values.length + 2;
  const values = [...filters.values, page.limit, page.offset];
  const [items, total] = await Promise.all([
    getPool().query<NullifierRow>(
      `SELECT ${nullifierColumns}
       FROM miden_nullifiers
       ${filters.where}
       ORDER BY miden_nullifiers.block_num DESC, nullifier ASC
        LIMIT $${limitParam} OFFSET $${offsetParam}`,
      values,
    ),
    cachedCount('miden_nullifiers', filters.where, filters.values),
  ]);
  sendJson(res, 200, paginated(items.rows.map(nullifierResponse), total, page));
}

async function handleNullifier(hex: string, res: http.ServerResponse): Promise<void> {
  const nullifier = parseHexParam(hex, 32);
  const { rows } = await getPool().query<NullifierRow>(
     `SELECT ${nullifierColumns} FROM miden_nullifiers WHERE nullifier = $1`,
     [nullifier],
   );
  if (rows.length === 0) throw new HttpError(404, 'not found', 'NOT_FOUND');
  sendJson(res, 200, nullifierResponse(rows[0]));
}

function accountFilters(url: URL): QueryParts {
  const parts: QueryParts = { where: '', values: [] };
  const isPublic = parseBooleanParam('is_public', url.searchParams.get('is_public'));
  if (isPublic !== null) addCondition(parts, 'is_public = ?', isPublic);
  return parts;
}

async function handleAccounts(url: URL, res: http.ServerResponse): Promise<void> {
  const page = parsePage(url);
  const filters = accountFilters(url);
  const limitParam = filters.values.length + 1;
  const offsetParam = filters.values.length + 2;
  const values = [...filters.values, page.limit, page.offset];
  const [items, total] = await Promise.all([
    getPool().query<AccountRow>(
      `SELECT ${accountColumns}
       FROM miden_accounts
       ${filters.where}
       ORDER BY miden_accounts.last_block_num DESC, account_id ASC
        LIMIT $${limitParam} OFFSET $${offsetParam}`,
      values,
    ),
    cachedCount('miden_accounts', filters.where, filters.values),
  ]);
  sendJson(res, 200, paginated(items.rows.map(accountResponse), total, page));
}

async function handleAccount(hex: string, res: http.ServerResponse): Promise<void> {
  const accountId = parseHexParam(hex, 15);
  const { rows } = await getPool().query<AccountRow>(
     `SELECT ${accountColumns} FROM miden_accounts WHERE account_id = $1`,
     [accountId],
   );
  if (rows.length === 0) throw new HttpError(404, 'not found', 'NOT_FOUND');
  sendJson(res, 200, accountResponse(rows[0]));
}

async function handleAccountTransactions(accountIdHex: string, url: URL, res: http.ServerResponse): Promise<void> {
  const accountId = parseHexParam(accountIdHex, 15);
  const page = parsePage(url);
  const [items, total] = await Promise.all([
    getPool().query<TransactionRow>(
      `SELECT ${transactionColumns}
       FROM miden_transactions
       ${transactionJoin}
       WHERE account_id = $1
       ORDER BY miden_transactions.block_num DESC, tx_id ASC
       LIMIT $2 OFFSET $3`,
      [accountId, page.limit, page.offset],
    ),
    cachedCount('miden_transactions', 'WHERE account_id = $1', [accountId]),
  ]);
  sendJson(res, 200, paginated(items.rows.map(transactionResponse), total, page));
}

async function handleSearch(url: URL, res: http.ServerResponse): Promise<void> {
  const query = url.searchParams.get('q');
  if (query === null || query === '') throw new HttpError(400, 'missing q', 'MISSING_QUERY');

  if (/^\d+$/.test(query)) {
    const blockNum = parseIntegerParam('q', query, true);
    if (blockNum === null || blockNum < 0) throw new HttpError(400, 'invalid q', 'INVALID_NUMERIC');
    const { rows } = await getPool().query<BlockDetailRow>(
      `SELECT ${blockSummaryColumns}
       FROM miden_blocks
       WHERE block_num = $1`,
      [blockNum],
    );
    const blocks = rows.map(blockDetailResponse);
    sendJson(res, 200, {
      query,
      type: blocks.length > 0 ? 'block' : 'not_found',
      results: {
        blocks: blocks.length > 0 ? blocks : null,
        transactions: null,
        notes: null,
        nullifiers: null,
        accounts: null,
      },
    });
    return;
  }

  if (HEX_RE.test(query) && query.length === 30) {
    const accountId = parseHexParam(query, 15);
    const { rows } = await getPool().query<AccountRow>(
      `SELECT ${accountColumns}
       FROM miden_accounts
       WHERE account_id = $1`,
      [accountId],
    );
    const accounts = rows.map(accountResponse);
    sendJson(res, 200, {
      query,
      type: accounts.length > 0 ? 'account' : 'not_found',
      results: {
        blocks: null,
        transactions: null,
        notes: null,
        nullifiers: null,
        accounts: accounts.length > 0 ? accounts : null,
      },
    });
    return;
  }

  if (!(HEX_RE.test(query) && query.length === 64)) {
    sendJson(res, 200, {
      query,
      type: 'not_found' satisfies SearchType,
      results: {
        blocks: null,
        transactions: null,
        notes: null,
        nullifiers: null,
        accounts: null,
      },
    });
    return;
  }

  const hex = parseHexParam(query, 32);
  const [blockRows, transactionRows, noteRows, nullifierRows] = await Promise.all([
    getPool().query<BlockDetailRow>(
      `SELECT ${blockSummaryColumns}
       FROM miden_blocks
       WHERE block_hash = $1`,
      [hex],
    ),
    getPool().query<TransactionRow>(
      `SELECT ${transactionColumns}
       FROM miden_transactions
       ${transactionJoin}
       WHERE tx_id = $1`,
      [hex],
    ),
    getPool().query<NoteRow>(
      `SELECT ${noteColumns}
       FROM miden_notes
       WHERE note_id = $1`,
      [hex],
    ),
    getPool().query<NullifierRow>(
      `SELECT ${nullifierColumns}
       FROM miden_nullifiers
       WHERE nullifier = $1`,
      [hex],
    ),
  ]);

  const blocks = blockRows.rows.map(blockDetailResponse);
  const transactions = transactionRows.rows.map(transactionResponse);
  const notes = noteRows.rows.map(noteResponse);
  const nullifiers = nullifierRows.rows.map(nullifierResponse);
  const matchTypes: SearchType[] = [
    ...(blocks.length > 0 ? ['block' as const] : []),
    ...(transactions.length > 0 ? ['tx' as const] : []),
    ...(notes.length > 0 ? ['note' as const] : []),
    ...(nullifiers.length > 0 ? ['nullifier' as const] : []),
  ];

  const type: SearchType = matchTypes.length === 0
    ? 'not_found'
    : matchTypes.length === 1
      ? matchTypes[0]
      : 'ambiguous';

  sendJson(res, 200, {
    query,
    type,
    results: {
      blocks: blocks.length > 0 ? blocks : null,
      transactions: transactions.length > 0 ? transactions : null,
      notes: notes.length > 0 ? notes : null,
      nullifiers: nullifiers.length > 0 ? nullifiers : null,
      accounts: null,
    },
  });
}

async function route(req: http.IncomingMessage, res: http.ServerResponse, options: ApiServerOptions): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const contentLength = Number.parseInt(req.headers['content-length'] ?? '0', 10);
  if (contentLength > JSON_BODY_LIMIT_BYTES) {
    throw new HttpError(413, 'payload too large', 'PAYLOAD_TOO_LARGE');
  }

  if (req.method !== 'GET') {
    throw new HttpError(405, 'method not allowed', 'METHOD_NOT_ALLOWED');
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

  if (url.pathname === '/health') {
    await handleHealth(res, options.getChainTip);
    return;
  }

  if (url.pathname === '/metrics') {
    if (!config.METRICS_ENABLED) {
      throw new HttpError(404, 'metrics disabled', 'METRICS_DISABLED');
    }
    const body = await metricsText();
    res.writeHead(200, { 'Content-Type': metricsContentType });
    res.end(body);
    return;
  }

  if (parts[0] !== 'api' || parts[1] !== 'v1') throw new HttpError(404, 'not found', 'NOT_FOUND');

  const resource = parts[2];
  if (parts.length === 3 && resource === 'stats') return handleStats(res);
  if (parts.length === 5 && resource === 'blocks' && parts[4] === 'transactions') return handleBlockTransactions(parts[3], url, res);
  if (parts.length === 5 && resource === 'blocks' && parts[4] === 'notes') return handleBlockNotes(parts[3], url, res);
  if (parts.length === 3 && resource === 'blocks') return handleBlocks(url, res);
  if (parts.length === 4 && resource === 'blocks') return handleBlockByNumber(parts[3], url, res);
  if (parts.length === 5 && resource === 'blocks' && parts[3] === 'by-hash') return handleBlockByHash(parts[4], url, res);
  if (parts.length === 3 && resource === 'transactions') return handleTransactions(url, res);
  if (parts.length === 4 && resource === 'transactions') return handleTransaction(parts[3], res);
  if (parts.length === 3 && resource === 'notes') return handleNotes(url, res);
  if (parts.length === 4 && resource === 'notes') return handleNote(parts[3], res);
  if (parts.length === 3 && resource === 'nullifiers') return handleNullifiers(url, res);
  if (parts.length === 4 && resource === 'nullifiers') return handleNullifier(parts[3], res);
  if (parts.length === 5 && resource === 'accounts' && parts[4] === 'transactions') return handleAccountTransactions(parts[3], url, res);
  if (parts.length === 3 && resource === 'accounts') return handleAccounts(url, res);
  if (parts.length === 4 && resource === 'accounts') return handleAccount(parts[3], res);
  if (parts.length === 3 && resource === 'search') return handleSearch(url, res);

  throw new HttpError(404, 'not found', 'NOT_FOUND');
}

function normalizeOptions(options: ApiServerArgument = {}): ApiServerOptions {
  return typeof options === 'function' ? { getChainTip: options } : options;
}

export function createApiServer(options: ApiServerArgument = {}): http.Server {
  const normalized = normalizeOptions(options);
  return http.createServer((req, res) => {
    route(req, res, normalized).catch((err: unknown) => {
      sendError(res, err);
    });
  });
}

export function startApiServer(options: ApiServerArgument = {}): () => void {
  const server = createApiServer(options);
  server.listen(config.INDEXER_HTTP_PORT, config.API_BIND, () => {
    logger.info('Miden indexer API server listening', {
      bind: config.API_BIND,
      port: config.INDEXER_HTTP_PORT,
    });
  });

  return () => {
    server.close();
  };
}

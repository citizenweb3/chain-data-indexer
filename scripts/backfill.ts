import 'dotenv/config';

import pg from 'pg';
import type { PoolClient } from 'pg';

import type { AccountRow, NoteRow, NullifierRow, TransactionRow } from '../src/types.js';
import type { DecodedBlock } from '../src/utils/decoder.js';

process.env.DECODER_URL ??= 'http://127.0.0.1:14000';

const { Pool } = pg;
const { decodeBlockBytes } = await import('../src/utils/decoder.js');

interface CliOptions {
  from: number;
  to: number;
  batch: number;
  concurrency: number;
}

interface CandidateBlockRow {
  block_num: string;
  raw_block_bytes: Buffer;
}

interface BackfillProgressRow {
  last_decoded_block: string;
}

interface BatchOutcome {
  done: number;
  skipped: number;
  highestBlock: number;
}

const DEFAULT_TO_BLOCK = Number.MAX_SAFE_INTEGER;

function parsePositiveInt(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer, got: ${value}`);
  }
  return parsed;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    from: 0,
    to: DEFAULT_TO_BLOCK,
    batch: 50,
    concurrency: 4,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    switch (arg) {
      case '--from':
        if (!next) throw new Error('--from requires a value');
        options.from = parsePositiveInt(next, '--from');
        i += 1;
        break;
      case '--to':
        if (!next) throw new Error('--to requires a value');
        options.to = parsePositiveInt(next, '--to');
        i += 1;
        break;
      case '--batch':
        if (!next) throw new Error('--batch requires a value');
        options.batch = parsePositiveInt(next, '--batch');
        if (options.batch < 1) throw new Error('--batch must be >= 1');
        i += 1;
        break;
      case '--concurrency':
        if (!next) throw new Error('--concurrency requires a value');
        options.concurrency = parsePositiveInt(next, '--concurrency');
        if (options.concurrency < 1) throw new Error('--concurrency must be >= 1');
        i += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.from > options.to) {
    throw new Error(`--from (${options.from}) must be <= --to (${options.to})`);
  }

  return options;
}

function createPool(concurrency: number): pg.Pool {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString) {
    return new Pool({
      connectionString,
      max: Math.max(4, concurrency + 2),
      application_name: 'miden-backfill',
    });
  }

  return new Pool({
    host: process.env.POSTGRES_HOST ?? process.env.PG_HOST ?? '127.0.0.1',
    port: Number(process.env.POSTGRES_PORT ?? process.env.PG_PORT ?? 15433),
    database: process.env.POSTGRES_DB ?? process.env.PG_DB ?? 'miden_indexer',
    user: process.env.POSTGRES_USER ?? process.env.PG_USER ?? 'miden',
    password: process.env.POSTGRES_PASSWORD ?? process.env.PG_PASSWORD ?? 'changeme',
    max: Math.max(4, concurrency + 2),
    application_name: 'miden-backfill',
  });
}

async function ensureBackfillProgressTable(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS miden_backfill_progress (
      id INT PRIMARY KEY DEFAULT 1,
      last_decoded_block BIGINT NOT NULL DEFAULT -1,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT chk_miden_backfill_progress_singleton CHECK (id = 1)
    )
  `);

  await pool.query(`
    INSERT INTO miden_backfill_progress (id, last_decoded_block)
    VALUES (1, -1)
    ON CONFLICT (id) DO NOTHING
  `);
}

async function getResumeCursor(pool: pg.Pool, fromBlock: number): Promise<number> {
  const { rows } = await pool.query<BackfillProgressRow>(
    'SELECT last_decoded_block FROM miden_backfill_progress WHERE id = 1',
  );

  const lastDecoded = rows.length > 0 ? Number(rows[0].last_decoded_block) : -1;
  return Math.max(fromBlock, lastDecoded + 1);
}

async function updateBackfillProgress(pool: pg.Pool, blockNum: number): Promise<void> {
  await pool.query(
    `INSERT INTO miden_backfill_progress (id, last_decoded_block, updated_at)
     VALUES (1, $1, now())
     ON CONFLICT (id) DO UPDATE
       SET last_decoded_block = GREATEST(
             miden_backfill_progress.last_decoded_block,
             EXCLUDED.last_decoded_block
           ),
           updated_at = now()`,
    [blockNum],
  );
}

async function fetchCandidateBlocks(
  pool: pg.Pool,
  cursor: number,
  toBlock: number,
  limit: number,
): Promise<CandidateBlockRow[]> {
  const { rows } = await pool.query<CandidateBlockRow>(
    `SELECT b.block_num, b.raw_block_bytes
     FROM miden_blocks AS b
     WHERE b.block_num >= $1
       AND b.block_num <= $2
       AND b.raw_block_bytes IS NOT NULL
       AND NOT (b.tx_count = 0 AND b.note_count = 0 AND b.nullifier_count = 0)
       AND NOT EXISTS (
         SELECT 1
         FROM miden_transactions AS t
         WHERE t.block_num = b.block_num
       )
       AND NOT EXISTS (
         SELECT 1
         FROM miden_notes AS n
         WHERE n.block_num = b.block_num
       )
       AND NOT EXISTS (
         SELECT 1
         FROM miden_nullifiers AS nf
         WHERE nf.block_num = b.block_num
       )
     ORDER BY b.block_num ASC
     LIMIT $3`,
    [cursor, toBlock, limit],
  );

  return rows;
}

async function withTransaction<T>(pool: pg.Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function bufferArrayToHexJson(values: Buffer[] | null | undefined): string | null {
  return values ? JSON.stringify(values.map((v) => v.toString('hex'))) : null;
}

async function insertTransactions(client: PoolClient, rows: TransactionRow[]): Promise<void> {
  if (rows.length === 0) return;

  await client.query(
    `INSERT INTO miden_transactions (
       tx_id, block_num, account_id, init_account_state, final_account_state,
       input_notes_commitment, output_notes_commitment, expiration_block_num,
       input_nullifiers, output_note_ids
     )
     SELECT
       tx_id, block_num, account_id, init_account_state, final_account_state,
       input_notes_commitment, output_notes_commitment, expiration_block_num,
       CASE WHEN nullifier_hexes IS NULL THEN NULL ELSE ARRAY(SELECT decode(v,'hex') FROM jsonb_array_elements_text(nullifier_hexes) AS v) END,
       CASE WHEN note_id_hexes  IS NULL THEN NULL ELSE ARRAY(SELECT decode(v,'hex') FROM jsonb_array_elements_text(note_id_hexes)  AS v) END
     FROM unnest(
       $1::bytea[], $2::bigint[], $3::bytea[], $4::bytea[], $5::bytea[],
       $6::bytea[], $7::bytea[], $8::bigint[], $9::jsonb[], $10::jsonb[]
     ) AS t(
       tx_id, block_num, account_id, init_account_state, final_account_state,
       input_notes_commitment, output_notes_commitment, expiration_block_num,
       nullifier_hexes, note_id_hexes
     )
     ON CONFLICT (tx_id) DO NOTHING`,
    [
      rows.map((row) => row.txId),
      rows.map((row) => row.blockNum),
      rows.map((row) => row.accountId),
      rows.map((row) => row.initAccountState ?? null),
      rows.map((row) => row.finalAccountState ?? null),
      rows.map((row) => row.inputNotesCommitment ?? null),
      rows.map((row) => row.outputNotesCommitment ?? null),
      rows.map((row) => row.expirationBlockNum ?? null),
      rows.map((row) => bufferArrayToHexJson(row.inputNullifiers)),
      rows.map((row) => bufferArrayToHexJson(row.outputNoteIds)),
    ],
  );
}

async function insertNotes(client: PoolClient, rows: NoteRow[]): Promise<void> {
  if (rows.length === 0) return;

  await client.query(
    `INSERT INTO miden_notes (
       note_id, block_num, note_index, is_public, metadata, sender, tag,
       note_type, attachment, aux, execution_hint, recipient_digest, assets,
       script_root, inputs_hash, serial_num, note_details
     )
     SELECT * FROM unnest(
       $1::bytea[], $2::bigint[], $3::int[], $4::boolean[], $5::bytea[],
       $6::bytea[], $7::bigint[], $8::smallint[], $9::bytea[], $10::bigint[],
       $11::bigint[], $12::bytea[], $13::bytea[], $14::bytea[], $15::bytea[],
       $16::bytea[], $17::bytea[]
     )
     ON CONFLICT (note_id) DO NOTHING`,
    [
      rows.map((row) => row.noteId),
      rows.map((row) => row.blockNum),
      rows.map((row) => row.noteIndex),
      rows.map((row) => row.isPublic),
      rows.map((row) => row.metadata),
      rows.map((row) => row.sender ?? null),
      rows.map((row) => row.tag ?? null),
      rows.map((row) => row.noteType ?? null),
      rows.map((row) => row.attachment ?? null),
      rows.map((row) => row.aux ?? null),
      rows.map((row) => row.executionHint ?? null),
      rows.map((row) => row.recipientDigest ?? null),
      rows.map((row) => row.assets ?? null),
      rows.map((row) => row.scriptRoot ?? null),
      rows.map((row) => row.inputsHash ?? null),
      rows.map((row) => row.serialNum ?? null),
      rows.map((row) => row.noteDetails ?? null),
    ],
  );
}

async function insertNullifiers(client: PoolClient, rows: NullifierRow[]): Promise<void> {
  if (rows.length === 0) return;

  await client.query(
    `INSERT INTO miden_nullifiers (nullifier, block_num, consumed_note_id)
     SELECT * FROM unnest($1::bytea[], $2::bigint[], $3::bytea[])
     ON CONFLICT (nullifier) DO NOTHING`,
    [
      rows.map((row) => row.nullifier),
      rows.map((row) => row.blockNum),
      rows.map((row) => row.consumedNoteId ?? null),
    ],
  );
}

async function upsertAccounts(client: PoolClient, rows: AccountRow[]): Promise<void> {
  if (rows.length === 0) return;

  const latestByAccount = new Map<string, AccountRow>();
  for (const row of rows) {
    const key = row.accountId.toString('hex');
    const existing = latestByAccount.get(key);
    if (!existing || row.lastBlockNum > existing.lastBlockNum) {
      latestByAccount.set(key, row);
    }
  }

  const dedupedRows = [...latestByAccount.values()];

  await client.query(
    `INSERT INTO miden_accounts (
       account_id, is_public, last_block_num, account_commitment, nonce,
       code_commitment, storage_commitment, vault_root, account_type, storage_mode
     )
     SELECT * FROM unnest(
       $1::bytea[], $2::boolean[], $3::bigint[], $4::bytea[], $5::bigint[],
       $6::bytea[], $7::bytea[], $8::bytea[], $9::smallint[], $10::smallint[]
     )
     ON CONFLICT (account_id) DO UPDATE SET
       is_public = EXCLUDED.is_public,
       last_block_num = EXCLUDED.last_block_num,
       account_commitment = EXCLUDED.account_commitment,
       nonce = EXCLUDED.nonce,
       code_commitment = EXCLUDED.code_commitment,
       storage_commitment = EXCLUDED.storage_commitment,
       vault_root = EXCLUDED.vault_root,
       account_type = EXCLUDED.account_type,
       storage_mode = EXCLUDED.storage_mode,
       updated_at = now()
     WHERE EXCLUDED.last_block_num > miden_accounts.last_block_num`,
    [
      dedupedRows.map((row) => row.accountId),
      dedupedRows.map((row) => row.isPublic),
      dedupedRows.map((row) => row.lastBlockNum),
      dedupedRows.map((row) => row.accountCommitment),
      dedupedRows.map((row) => row.nonce ?? null),
      dedupedRows.map((row) => row.codeCommitment ?? null),
      dedupedRows.map((row) => row.storageCommitment ?? null),
      dedupedRows.map((row) => row.vaultRoot ?? null),
      dedupedRows.map((row) => row.accountType ?? null),
      dedupedRows.map((row) => row.storageMode ?? null),
    ],
  );
}

function toTransactions(blockNum: number, decoded: DecodedBlock): TransactionRow[] {
  return decoded.transactions.map((tx) => ({
    txId: tx.txId,
    blockNum,
    accountId: tx.accountId,
    initAccountState: tx.initState,
    finalAccountState: tx.finalState,
    expirationBlockNum: tx.expirationBlockNum ?? null,
    inputNotesCommitment: tx.inputNotesCommitment ?? null,
  }));
}

function toNotes(blockNum: number, decoded: DecodedBlock): NoteRow[] {
  return decoded.notes.map((note) => ({
    noteId: note.noteId,
    blockNum,
    noteIndex: note.noteIndex,
    isPublic: note.isPublic,
    metadata: note.metadataWord,
    sender: note.sender,
    tag: note.tag,
  }));
}

function toNullifiers(blockNum: number, decoded: DecodedBlock): NullifierRow[] {
  return decoded.nullifiers.map((nullifier) => ({
    nullifier: nullifier.nullifier,
    blockNum,
  }));
}

function toAccounts(blockNum: number, decoded: DecodedBlock): AccountRow[] {
  return decoded.accountUpdates.map((account) => ({
    accountId: account.accountId,
    isPublic: !account.isPrivate,
    lastBlockNum: blockNum,
    accountCommitment: account.finalState,
  }));
}

async function insertDecodedBlock(pool: pg.Pool, blockNum: number, decoded: DecodedBlock): Promise<void> {
  await withTransaction(pool, async (client) => {
    await insertTransactions(client, toTransactions(blockNum, decoded));
    await insertNotes(client, toNotes(blockNum, decoded));
    await insertNullifiers(client, toNullifiers(blockNum, decoded));
    await upsertAccounts(client, toAccounts(blockNum, decoded));
  });
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  if (values.length === 0) return [];

  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, values.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      for (;;) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        if (currentIndex >= values.length) return;
        results[currentIndex] = await worker(values[currentIndex]!);
      }
    }),
  );

  return results;
}

async function processBatch(
  pool: pg.Pool,
  rows: CandidateBlockRow[],
  concurrency: number,
  cursor: number,
): Promise<BatchOutcome> {
  const highestBlock = Number(rows[rows.length - 1].block_num);
  const rangeSkipped = highestBlock - cursor + 1 - rows.length;

  const outcomes = await mapWithConcurrency(rows, concurrency, async (row) => {
    const blockNum = Number(row.block_num);

    try {
      const decoded = await decodeBlockBytes(blockNum, row.raw_block_bytes);
      if (!decoded) {
        console.warn(`[warn] skipping block ${blockNum}: decoder returned no decoded payload`);
        return { status: 'skipped' as const };
      }

      await insertDecodedBlock(pool, blockNum, decoded);
      return { status: 'done' as const };
    } catch (error) {
      console.warn(`[warn] skipping block ${blockNum}: ${String(error)}`);
      return { status: 'skipped' as const };
    }
  });

  let done = 0;
  let skipped = rangeSkipped;
  for (const outcome of outcomes) {
    if (outcome.status === 'done') {
      done += 1;
    } else {
      skipped += 1;
    }
  }

  await updateBackfillProgress(pool, highestBlock);

  return { done, skipped, highestBlock };
}

function logProgress(
  highestBlock: number,
  done: number,
  skipped: number,
  startedAtMs: number,
): void {
  const elapsedSec = (Date.now() - startedAtMs) / 1_000;
  const total = done + skipped;
  const rate = elapsedSec > 0 ? total / elapsedSec : 0;

  console.log(
    `Backfilled up to block ${highestBlock} (${done} blocks done, ${skipped} skipped, elapsed ${elapsedSec.toFixed(1)}s, rate ${rate.toFixed(2)} blocks/s)`,
  );
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const pool = createPool(options.concurrency);
  const startedAtMs = Date.now();

  try {
    await ensureBackfillProgressTable(pool);

    let cursor = await getResumeCursor(pool, options.from);
    let done = 0;
    let skipped = 0;
    let lastLoggedCovered = 0;

    console.log(
      `Starting backfill from block ${cursor} to ${options.to} (batch=${options.batch}, concurrency=${options.concurrency})`,
    );

    while (cursor <= options.to) {
      const rows = await fetchCandidateBlocks(pool, cursor, options.to, options.batch);

      if (rows.length === 0) {
        skipped += options.to - cursor + 1;
        await updateBackfillProgress(pool, options.to);
        break;
      }

      const outcome = await processBatch(pool, rows, options.concurrency, cursor);
      done += outcome.done;
      skipped += outcome.skipped;
      cursor = outcome.highestBlock + 1;

      const covered = done + skipped;
      if (covered - lastLoggedCovered >= 1000) {
        logProgress(outcome.highestBlock, done, skipped, startedAtMs);
        lastLoggedCovered = covered;
      }
    }

    logProgress(Math.min(cursor - 1, options.to), done, skipped, startedAtMs);
  } finally {
    await pool.end();
  }
}

await main().catch((error) => {
  console.error('[fatal] backfill failed', error);
  process.exitCode = 1;
});

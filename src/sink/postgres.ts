import { createHash } from 'node:crypto';
import type pg from 'pg';
import { withTx } from '../db/pg.js';
import { observeFlush } from '../metrics/registry.js';
import type { AccountRow, BlockBundle, NoteRow, NullifierRow, TransactionRow } from '../types.js';

export type { AccountRow, BlockBundle, NoteRow, NullifierRow, TransactionRow } from '../types.js';

type QueryRunner = pg.PoolClient;

interface BlockInsertRow {
  blockNum: number;
  blockHash: Buffer;
  prevBlockCommitment: Buffer;
  chainCommitment: Buffer;
  accountRoot: Buffer;
  nullifierRoot: Buffer;
  noteRoot: Buffer;
  txCommitment: Buffer;
  validatorKey: Buffer;
  txKernelCommitment: Buffer;
  nativeAssetId: Buffer;
  verificationBaseFee: number;
  timestamp: Date;
  txCount: number;
  noteCount: number;
  nullifierCount: number;
  version: number | null;
  rawBlockBytes: Buffer | null;
  chainLength: number | null;
}

function sha256(bytes: Buffer): Buffer {
  return createHash('sha256').update(bytes).digest();
}

function encodeUInt32BE(value: number, field: string): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError(`block ${field} is out of uint32 range: ${value}`);
  }
  const buf = Buffer.allocUnsafe(4);
  buf.writeUInt32BE(value, 0);
  return buf;
}

function encodeLengthPrefixed(bytes: Buffer): Buffer {
  return Buffer.concat([encodeUInt32BE(bytes.length, 'length'), bytes]);
}

export function deriveBlockHash(header: BlockBundle['header'], blockBytes: Buffer): Buffer {
  if (blockBytes.length > 0) {
    return sha256(blockBytes);
  }

  if (!header.validatorKey) {
    throw new Error(`block ${header.blockNum} is missing validator_key`);
  }
  if (!header.feeParameters) {
    throw new Error(`block ${header.blockNum} is missing fee_parameters`);
  }

  return sha256(Buffer.concat([
    Buffer.from('miden-block-hash-fallback-v1\0', 'utf8'),
    encodeUInt32BE(header.version, 'version'),
    encodeUInt32BE(header.blockNum, 'blockNum'),
    header.prevBlockCommitment,
    header.chainCommitment,
    header.accountRoot,
    header.nullifierRoot,
    header.noteRoot,
    header.txCommitment,
    header.txKernelCommitment,
    encodeLengthPrefixed(header.validatorKey.validatorKey),
    encodeLengthPrefixed(header.feeParameters.nativeAssetId),
    encodeUInt32BE(header.feeParameters.verificationBaseFee, 'verificationBaseFee'),
    encodeUInt32BE(header.timestamp, 'timestamp'),
  ]));
}

function toBlockRow(bundle: BlockBundle): BlockInsertRow {
  const { header } = bundle;
  if (!header.validatorKey) {
    throw new Error(`block ${header.blockNum} is missing validator_key`);
  }
  if (!header.feeParameters) {
    throw new Error(`block ${header.blockNum} is missing fee_parameters`);
  }
  return {
    blockNum: header.blockNum,
    blockHash: deriveBlockHash(header, bundle.blockBytes),
    prevBlockCommitment: header.prevBlockCommitment,
    chainCommitment: header.chainCommitment,
    accountRoot: header.accountRoot,
    nullifierRoot: header.nullifierRoot,
    noteRoot: header.noteRoot,
    txCommitment: header.txCommitment,
    validatorKey: header.validatorKey.validatorKey,
    txKernelCommitment: header.txKernelCommitment,
    nativeAssetId: header.feeParameters.nativeAssetId,
    verificationBaseFee: header.feeParameters.verificationBaseFee,
    timestamp: new Date(header.timestamp * 1000),
    txCount: bundle.txCount,
    noteCount: bundle.noteCount,
    nullifierCount: bundle.nullifierCount,
    version: header.version,
    rawBlockBytes: bundle.blockBytes.length > 0 ? bundle.blockBytes : null,
    chainLength: null,
  };
}

async function insertBlocks(client: QueryRunner, bundles: BlockBundle[]): Promise<void> {
  if (bundles.length === 0) return;
  const rows = bundles.map(toBlockRow);
  await client.query(
    `INSERT INTO miden_blocks (
       block_num, block_hash, prev_block_commitment, chain_commitment,
       account_root, nullifier_root, note_root, tx_commitment, validator_key,
       tx_kernel_commitment, native_asset_id, verification_base_fee, timestamp,
       tx_count, note_count, nullifier_count, version, raw_block_bytes, chain_length
     )
     SELECT * FROM unnest(
       $1::bigint[], $2::bytea[], $3::bytea[], $4::bytea[], $5::bytea[],
       $6::bytea[], $7::bytea[], $8::bytea[], $9::bytea[], $10::bytea[],
       $11::bytea[], $12::bigint[], $13::timestamptz[], $14::int[],
       $15::int[], $16::int[], $17::int[], $18::bytea[], $19::bigint[]
     )
     ON CONFLICT (block_num) DO NOTHING`,
    [
      rows.map((r) => r.blockNum),
      rows.map((r) => r.blockHash),
      rows.map((r) => r.prevBlockCommitment),
      rows.map((r) => r.chainCommitment),
      rows.map((r) => r.accountRoot),
      rows.map((r) => r.nullifierRoot),
      rows.map((r) => r.noteRoot),
      rows.map((r) => r.txCommitment),
      rows.map((r) => r.validatorKey),
      rows.map((r) => r.txKernelCommitment),
      rows.map((r) => r.nativeAssetId),
      rows.map((r) => r.verificationBaseFee),
      rows.map((r) => r.timestamp),
      rows.map((r) => r.txCount),
      rows.map((r) => r.noteCount),
      rows.map((r) => r.nullifierCount),
      rows.map((r) => r.version),
      rows.map((r) => r.rawBlockBytes),
      rows.map((r) => r.chainLength),
    ],
  );
}

function flatten<T>(blocks: BlockBundle[], selector: (block: BlockBundle) => T[] | undefined): T[] {
  return blocks.flatMap((block) => selector(block) ?? []);
}

function bufferArrayToHexJson(values: Buffer[] | null | undefined): string | null {
  return values ? JSON.stringify(values.map((value) => value.toString('hex'))) : null;
}

async function insertTransactions(client: QueryRunner, rows: TransactionRow[]): Promise<void> {
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
       CASE WHEN input_nullifier_hexes IS NULL THEN NULL ELSE ARRAY(SELECT decode(v, 'hex') FROM jsonb_array_elements_text(input_nullifier_hexes) AS v) END,
       CASE WHEN output_note_id_hexes IS NULL THEN NULL ELSE ARRAY(SELECT decode(v, 'hex') FROM jsonb_array_elements_text(output_note_id_hexes) AS v) END
     FROM unnest(
       $1::bytea[], $2::bigint[], $3::bytea[], $4::bytea[], $5::bytea[],
       $6::bytea[], $7::bytea[], $8::bigint[], $9::jsonb[], $10::jsonb[]
     ) AS t(
       tx_id, block_num, account_id, init_account_state, final_account_state,
       input_notes_commitment, output_notes_commitment, expiration_block_num,
       input_nullifier_hexes, output_note_id_hexes
     )
     ON CONFLICT (tx_id) DO NOTHING`,
    [
      rows.map((r) => r.txId),
      rows.map((r) => r.blockNum),
      rows.map((r) => r.accountId),
      rows.map((r) => r.initAccountState ?? null),
      rows.map((r) => r.finalAccountState ?? null),
      rows.map((r) => r.inputNotesCommitment ?? null),
      rows.map((r) => r.outputNotesCommitment ?? null),
      rows.map((r) => r.expirationBlockNum ?? null),
      rows.map((r) => bufferArrayToHexJson(r.inputNullifiers)),
      rows.map((r) => bufferArrayToHexJson(r.outputNoteIds)),
    ],
  );
}

async function insertNotes(client: QueryRunner, rows: NoteRow[]): Promise<void> {
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
      rows.map((r) => r.noteId),
      rows.map((r) => r.blockNum),
      rows.map((r) => r.noteIndex),
      rows.map((r) => r.isPublic),
      rows.map((r) => r.metadata),
      rows.map((r) => r.sender ?? null),
      rows.map((r) => r.tag ?? null),
      rows.map((r) => r.noteType ?? null),
      rows.map((r) => r.attachment ?? null),
      rows.map((r) => r.aux ?? null),
      rows.map((r) => r.executionHint ?? null),
      rows.map((r) => r.recipientDigest ?? null),
      rows.map((r) => r.assets ?? null),
      rows.map((r) => r.scriptRoot ?? null),
      rows.map((r) => r.inputsHash ?? null),
      rows.map((r) => r.serialNum ?? null),
      rows.map((r) => r.noteDetails ?? null),
    ],
  );
}

async function insertNullifiers(client: QueryRunner, rows: NullifierRow[]): Promise<void> {
  if (rows.length === 0) return;
  await client.query(
    `INSERT INTO miden_nullifiers (nullifier, block_num, consumed_note_id)
     SELECT * FROM unnest($1::bytea[], $2::bigint[], $3::bytea[])
     ON CONFLICT (nullifier) DO NOTHING`,
    [rows.map((r) => r.nullifier), rows.map((r) => r.blockNum), rows.map((r) => r.consumedNoteId ?? null)],
  );
}

async function upsertAccounts(client: QueryRunner, rows: AccountRow[]): Promise<void> {
  if (rows.length === 0) return;
  // Deduplicate: keep only the latest update per account_id (highest lastBlockNum).
  // PostgreSQL ON CONFLICT DO UPDATE fails if the same key appears twice in the same unnest.
  const deduped = new Map<string, AccountRow>();
  for (const row of rows) {
    const key = row.accountId.toString('hex');
    const existing = deduped.get(key);
    if (!existing || row.lastBlockNum > existing.lastBlockNum) {
      deduped.set(key, row);
    }
  }
  const dedupedRows = [...deduped.values()];

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
      dedupedRows.map((r) => r.accountId),
      dedupedRows.map((r) => r.isPublic),
      dedupedRows.map((r) => r.lastBlockNum),
      dedupedRows.map((r) => r.accountCommitment),
      dedupedRows.map((r) => r.nonce ?? null),
      dedupedRows.map((r) => r.codeCommitment ?? null),
      dedupedRows.map((r) => r.storageCommitment ?? null),
      dedupedRows.map((r) => r.vaultRoot ?? null),
      dedupedRows.map((r) => r.accountType ?? null),
      dedupedRows.map((r) => r.storageMode ?? null),
    ],
  );
}

async function insertFullScopeRows(client: QueryRunner, blocks: BlockBundle[]): Promise<void> {
  const transactions = flatten(blocks, (block) => block.transactions);
  const notes = flatten(blocks, (block) => block.notes);
  const nullifiers = flatten(blocks, (block) => block.nullifiers);
  const accountUpdates = flatten(blocks, (block) => block.accountUpdates);

  // TODO(full-scope): runner currently leaves these arrays undefined; SQL is ready when populated.
  await insertTransactions(client, transactions);
  await insertNotes(client, notes);
  await insertNullifiers(client, nullifiers);
  await upsertAccounts(client, accountUpdates);
}

async function updateProgress(client: QueryRunner, blockNum: number): Promise<void> {
  await client.query(
    `INSERT INTO miden_indexer_progress (id, last_block)
     VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET
       last_block = GREATEST(miden_indexer_progress.last_block, EXCLUDED.last_block),
       updated_at = now()`,
    [blockNum],
  );
}

async function updateBatchProgress(client: QueryRunner, blocks: BlockBundle[]): Promise<void> {
  if (blocks.length === 0) return;
  await client.query(
    `INSERT INTO miden_indexer_progress (id, last_block)
     SELECT 1, MAX(block_num)
     FROM unnest($1::bigint[]) AS t(block_num)
     ON CONFLICT (id) DO UPDATE SET
       last_block = GREATEST(miden_indexer_progress.last_block, EXCLUDED.last_block),
       updated_at = now()`,
    [blocks.map((block) => block.header.blockNum)],
  );
}

export async function processBlock(pool: pg.Pool, b: BlockBundle): Promise<void> {
  const start = process.hrtime.bigint();
  await withTx(pool, async (client) => {
    await insertBlocks(client, [b]);
    // TODO(full-scope): runner currently leaves these arrays undefined; SQL is ready when populated.
    if (b.transactions) await insertTransactions(client, b.transactions);
    if (b.notes) await insertNotes(client, b.notes);
    if (b.nullifiers) await insertNullifiers(client, b.nullifiers);
    if (b.accountUpdates) await upsertAccounts(client, b.accountUpdates);
    await updateProgress(client, b.header.blockNum);
  });
  const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
  observeFlush('core', durationSec, {
    miden_blocks: 1,
    miden_transactions: b.transactions?.length ?? 0,
    miden_notes: b.notes?.length ?? 0,
    miden_nullifiers: b.nullifiers?.length ?? 0,
    miden_accounts: b.accountUpdates?.length ?? 0,
    miden_indexer_progress: 1,
  });
}

export async function processBatch(pool: pg.Pool, blocks: BlockBundle[]): Promise<void> {
  if (blocks.length === 0) return;
  const start = process.hrtime.bigint();
  await withTx(pool, async (client) => {
    await insertBlocks(client, blocks);
    await insertFullScopeRows(client, blocks);
    await updateBatchProgress(client, blocks);
  });
  const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
  let txCount = 0;
  let noteCount = 0;
  let nullifierCount = 0;
  let accountCount = 0;
  for (const b of blocks) {
    txCount += b.transactions?.length ?? 0;
    noteCount += b.notes?.length ?? 0;
    nullifierCount += b.nullifiers?.length ?? 0;
    accountCount += b.accountUpdates?.length ?? 0;
  }
  observeFlush('core', durationSec, {
    miden_blocks: blocks.length,
    miden_transactions: txCount,
    miden_notes: noteCount,
    miden_nullifiers: nullifierCount,
    miden_accounts: accountCount,
    miden_indexer_progress: 1,
  });
}

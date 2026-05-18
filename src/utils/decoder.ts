import { config } from '../config.js';
import { logger } from './logger.js';

// ── Types matching the sidecar's JSON response ───────────────────────────────

interface TxData {
  tx_id: string;
  account_id: string;
  init_state: string;
  final_state: string;
  expiration_block_num: number | null;
  input_notes_commitment: string | null;
}

interface NoteData {
  note_id: string;
  batch_index: number;
  note_index: number;
  tag: number;
  sender: string;
  is_public: boolean;
  metadata_word: string;
}

interface NullifierData {
  nullifier: string;
}

interface AccountUpdateData {
  account_id: string;
  final_state: string;
  is_private: boolean;
}

interface DecodeSuccess {
  status: 'ok';
  tx_count: number;
  note_count: number;
  nullifier_count: number;
  account_update_count: number;
  transactions: TxData[];
  notes: NoteData[];
  nullifiers: NullifierData[];
  account_updates: AccountUpdateData[];
}

interface DecodeError {
  status: 'error';
  message: string;
}

type DecodeResponse = DecodeSuccess | DecodeError;

// ── Exported result types (using Buffer for DB compatibility) ─────────────────

export interface DecodedBlock {
  txCount: number;
  noteCount: number;
  nullifierCount: number;
  transactions: Array<{
    txId: Buffer;
    accountId: Buffer;
    initState: Buffer;
    finalState: Buffer;
    expirationBlockNum: number | null;
    inputNotesCommitment: Buffer | null;
  }>;
  notes: Array<{
    noteId: Buffer;
    batchIndex: number;
    noteIndex: number;
    tag: number;
    sender: Buffer;
    isPublic: boolean;
    metadataWord: Buffer;
  }>;
  nullifiers: Array<{ nullifier: Buffer }>;
  accountUpdates: Array<{
    accountId: Buffer;
    finalState: Buffer;
    isPrivate: boolean;
  }>;
}

// ── hex helpers ───────────────────────────────────────────────────────────────

/** Strip leading "0x" (if any) and decode a hex string to a Buffer. */
function hexToBuffer(hex: string): Buffer {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  return Buffer.from(clean, 'hex');
}

// ── Client ───────────────────────────────────────────────────────────────────

/**
 * Call the Rust decoder sidecar to decode raw block bytes.
 *
 * Returns `null` when the sidecar is not configured (DECODER_URL unset) or
 * the bytes are empty — the caller falls back to heuristic counts.
 */
export async function decodeBlockBytes(
  blockNum: number,
  blockBytes: Buffer,
): Promise<DecodedBlock | null> {
  if (!config.DECODER_URL || blockBytes.length === 0) {
    return null;
  }

  const url = `${config.DECODER_URL.replace(/\/$/, '')}/decode`;
  const body = JSON.stringify({
    block_num: blockNum,
    bytes: blockBytes.toString('hex'),
  });

  let raw: Response;
  try {
    raw = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    logger.warn('Decoder sidecar unreachable; falling back to heuristics', {
      block_num: blockNum,
      err: String(err),
    });
    return null;
  }

  const json = (await raw.json()) as DecodeResponse;

  if (json.status === 'error') {
    logger.warn('Decoder sidecar returned error; falling back to heuristics', {
      block_num: blockNum,
      message: json.message,
    });
    return null;
  }

  return {
    txCount: json.tx_count,
    noteCount: json.note_count,
    nullifierCount: json.nullifier_count,
    transactions: json.transactions.map((t) => ({
      txId: hexToBuffer(t.tx_id),
      accountId: hexToBuffer(t.account_id),
      initState: hexToBuffer(t.init_state),
      finalState: hexToBuffer(t.final_state),
      expirationBlockNum: t.expiration_block_num,
      inputNotesCommitment: t.input_notes_commitment ? hexToBuffer(t.input_notes_commitment) : null,
    })),
    notes: json.notes.map((n) => ({
      noteId: hexToBuffer(n.note_id),
      batchIndex: n.batch_index,
      noteIndex: n.note_index,
      tag: n.tag,
      sender: hexToBuffer(n.sender),
      isPublic: n.is_public,
      metadataWord: hexToBuffer(n.metadata_word),
    })),
    nullifiers: json.nullifiers.map((n) => ({
      nullifier: hexToBuffer(n.nullifier),
    })),
    accountUpdates: json.account_updates.map((a) => ({
      accountId: hexToBuffer(a.account_id),
      finalState: hexToBuffer(a.final_state),
      isPrivate: a.is_private,
    })),
  };
}

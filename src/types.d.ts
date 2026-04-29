export type * from './rpc/types.js';

import type { BlockHeader } from './rpc/types.js';

export interface TransactionRow {
  txId: Buffer;
  blockNum: number;
  accountId: Buffer;
  initAccountState?: Buffer | null;
  finalAccountState?: Buffer | null;
  inputNotesCommitment?: Buffer | null;
  outputNotesCommitment?: Buffer | null;
  expirationBlockNum?: number | null;
  inputNullifiers?: Buffer[] | null;
  outputNoteIds?: Buffer[] | null;
}

export interface NoteRow {
  noteId: Buffer;
  blockNum: number;
  noteIndex: number;
  isPublic: boolean;
  metadata: Buffer;
  sender?: Buffer | null;
  tag?: number | null;
  noteType?: number | null;
  attachment?: Buffer | null;
  aux?: number | null;
  executionHint?: number | null;
  recipientDigest?: Buffer | null;
  assets?: Buffer | null;
  scriptRoot?: Buffer | null;
  inputsHash?: Buffer | null;
  serialNum?: Buffer | null;
  noteDetails?: Buffer | null;
}

export interface NullifierRow {
  nullifier: Buffer;
  blockNum: number;
  consumedNoteId?: Buffer | null;
}

export interface AccountRow {
  accountId: Buffer;
  isPublic: boolean;
  lastBlockNum: number;
  accountCommitment: Buffer;
  nonce?: string | number | null;
  codeCommitment?: Buffer | null;
  storageCommitment?: Buffer | null;
  vaultRoot?: Buffer | null;
  accountType?: number | null;
  storageMode?: number | null;
}

export interface BlockBundle {
  header: BlockHeader;
  blockBytes: Buffer;
  txCount: number;
  noteCount: number;
  nullifierCount: number;
  transactions?: TransactionRow[];
  notes?: NoteRow[];
  nullifiers?: NullifierRow[];
  accountUpdates?: AccountRow[];
}

import type { LogosTransaction, MantleTxOp } from './types.js';

const OPCODE_NAMES: Record<number, string> = {
  0x00: 'Transfer',
  0x10: 'ChannelSetKeys',
  0x11: 'ChannelInscribe',
  0x12: 'ChannelDeposit',
  0x13: 'ChannelWithdraw',
  0x20: 'SDPDeclare',
  0x21: 'SDPWithdraw',
  0x22: 'SDPActive',
  0x30: 'LeaderClaim',
};

const KNOWN_PROOF_TYPES = [
  'Ed25519Sig',
  'ZkSig',
  'ZkAndEd25519Sigs',
  'PoC',
  'ChannelWithdrawProof',
] as const;

const HEX_PREVIEW_BYTES = 32;
const ASCII_FRAGMENT_MIN = 6;
const ASCII_FRAGMENT_LIMIT = 3;

type Primitive = string | number | boolean | null;

export interface BytePreview {
  format: 'bytes';
  length: number;
  hex_preview: string;
  truncated: boolean;
  ascii_fragments?: string[];
}

export type DecodedValue = Primitive | BytePreview | DecodedValue[] | { [key: string]: DecodedValue };

export interface DecodedTxOp {
  index: number;
  opcode: number;
  opcode_name: string;
  proof_type: string | null;
  payload: DecodedValue;
}

export interface DecodedTransaction {
  format: 'safe-explorer-v1';
  op_count: number;
  proof_count: number;
  op_types: string[];
  proof_types: string[];
  ops: DecodedTxOp[];
}

export interface TransactionShape {
  hash: string | null;
  opCount: number;
  opTypes: string[];
  proofTypes: string[];
  storageGasPrice: number | null;
  executionGasPrice: number | null;
  decoded: DecodedTransaction | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isByteArray(value: unknown): value is number[] {
  return Array.isArray(value)
    && value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255);
}

function previewHex(bytes: number[]): string {
  return Buffer.from(bytes.slice(0, HEX_PREVIEW_BYTES)).toString('hex');
}

function extractAsciiFragments(bytes: number[]): string[] {
  const fragments: string[] = [];
  let current: number[] = [];

  const flush = () => {
    if (current.length >= ASCII_FRAGMENT_MIN && fragments.length < ASCII_FRAGMENT_LIMIT) {
      fragments.push(Buffer.from(current).toString('utf8'));
    }
    current = [];
  };

  for (const byte of bytes) {
    if (byte >= 32 && byte <= 126) {
      current.push(byte);
      continue;
    }
    flush();
    if (fragments.length >= ASCII_FRAGMENT_LIMIT) break;
  }

  if (fragments.length < ASCII_FRAGMENT_LIMIT) {
    flush();
  }

  return fragments;
}

function normalizeValue(value: unknown): DecodedValue {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (isByteArray(value)) {
    const asciiFragments = extractAsciiFragments(value);
    const preview: BytePreview = {
      format: 'bytes',
      length: value.length,
      hex_preview: previewHex(value),
      truncated: value.length > HEX_PREVIEW_BYTES,
    };
    if (asciiFragments.length > 0) {
      preview.ascii_fragments = asciiFragments;
    }
    return preview;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizeValue(entry)]),
    );
  }
  return String(value);
}

function opcodeName(opcode: number): string {
  return OPCODE_NAMES[opcode] ?? `Unknown(0x${opcode.toString(16).padStart(2, '0')})`;
}

function proofType(proof: unknown): string | null {
  if (!isRecord(proof)) return null;
  for (const knownType of KNOWN_PROOF_TYPES) {
    if (knownType in proof) return knownType;
  }
  const keys = Object.keys(proof);
  return keys.length === 1 ? keys[0] : null;
}

function decodeOp(op: MantleTxOp, index: number, proof: unknown): DecodedTxOp {
  return {
    index,
    opcode: op.opcode,
    opcode_name: opcodeName(op.opcode),
    proof_type: proofType(proof),
    payload: normalizeValue(op.payload),
  };
}

export function getTransactionShape(raw: unknown): TransactionShape {
  const tx = isRecord(raw) ? raw as LogosTransaction : null;
  const mantleTx = tx?.mantle_tx;
  const ops = Array.isArray(mantleTx?.ops) ? mantleTx.ops : [];
  const proofs = Array.isArray(tx?.ops_proofs) ? tx.ops_proofs : [];
  const decodedOps = ops.map((op, index) => decodeOp(op, index, proofs[index]));
  const opTypes = decodedOps.map((op) => op.opcode_name);
  const proofTypes = decodedOps
    .map((op) => op.proof_type)
    .filter((kind): kind is string => typeof kind === 'string');

  return {
    hash: typeof mantleTx?.hash === 'string' ? mantleTx.hash : null,
    opCount: ops.length,
    opTypes,
    proofTypes,
    storageGasPrice: typeof mantleTx?.storage_gas_price === 'number' ? mantleTx.storage_gas_price : null,
    executionGasPrice: typeof mantleTx?.execution_gas_price === 'number' ? mantleTx.execution_gas_price : null,
    decoded: decodedOps.length > 0
      ? {
          format: 'safe-explorer-v1',
          op_count: ops.length,
          proof_count: proofs.length,
          op_types: opTypes,
          proof_types: proofTypes,
          ops: decodedOps,
        }
      : null,
  };
}

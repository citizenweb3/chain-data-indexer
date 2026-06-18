import JSONbigFactory from 'json-bigint';
import type { MoneroTxJson } from './types.js';

const JSONbig = JSONbigFactory({ storeAsString: true });

export interface DecodedMoneroTransaction {
  format: 'safe-monero-explorer-v1';
  version: number | null;
  unlock_time: string | null;
  is_coinbase: boolean;
  inputs_count: number;
  outputs_count: number;
  extra_length: number;
  fee_atomic: string | null;
}

export interface DecodedMoneroSummaryInput {
  version: number | null;
  unlockTime: string | null;
  isCoinbase: boolean;
  inputsCount: number;
  outputsCount: number;
  extraLength: number;
  feeAtomic: string | null;
}

export interface TransactionShape {
  hash: string | null;
  version: number | null;
  unlockTime: string | null;
  isCoinbase: boolean;
  inputsCount: number;
  outputsCount: number;
  extraLength: number;
  feeAtomic: string | null;
  sizeBytes: number | null;
  decoded: DecodedMoneroTransaction | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseTxJson(raw: unknown): MoneroTxJson | null {
  if (!isRecord(raw)) return null;
  if ('parsed_json' in raw && isRecord(raw.parsed_json)) {
    return raw.parsed_json as MoneroTxJson;
  }
  if (typeof raw.as_json !== 'string' || raw.as_json.length === 0) return null;
  try {
    return JSONbig.parse(raw.as_json) as MoneroTxJson;
  } catch {
    return null;
  }
}

function coerceInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function coerceIntegerString(value: unknown): string | null {
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  return null;
}

function coerceAtomicString(value: unknown): string | null {
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  return null;
}

function isCoinbaseTx(parsed: MoneroTxJson | null): boolean {
  const firstInput = Array.isArray(parsed?.vin) ? parsed.vin[0] : null;
  return isRecord(firstInput) && isRecord(firstInput.gen);
}

function txFeeAtomic(parsed: MoneroTxJson | null): string | null {
  if (!parsed) return null;
  const directFee = coerceAtomicString(parsed.fee);
  if (directFee) return directFee;
  if (isRecord(parsed.rct_signatures)) {
    return coerceAtomicString(parsed.rct_signatures.txnFee);
  }
  return null;
}

export function buildDecodedMoneroTransaction(input: DecodedMoneroSummaryInput): DecodedMoneroTransaction {
  return {
    format: 'safe-monero-explorer-v1',
    version: input.version,
    unlock_time: input.unlockTime,
    is_coinbase: input.isCoinbase,
    inputs_count: input.inputsCount,
    outputs_count: input.outputsCount,
    extra_length: input.extraLength,
    fee_atomic: input.feeAtomic,
  };
}

export function getTransactionShape(raw: unknown): TransactionShape {
  const record = isRecord(raw) ? raw : null;
  const parsed = parseTxJson(raw);
  const version = coerceInteger(parsed?.version);
  const unlockTime = coerceIntegerString(parsed?.unlock_time);
  const inputsCount = Array.isArray(parsed?.vin) ? parsed.vin.length : 0;
  const outputsCount = Array.isArray(parsed?.vout) ? parsed.vout.length : 0;
  const extraLength = Array.isArray(parsed?.extra) ? parsed.extra.length : 0;
  const feeAtomic = txFeeAtomic(parsed);
  const isCoinbase = isCoinbaseTx(parsed);
  const asHex = typeof record?.as_hex === 'string' ? record.as_hex : null;

  return {
    hash: typeof record?.tx_hash === 'string' ? record.tx_hash : null,
    version,
    unlockTime,
    isCoinbase,
    inputsCount,
    outputsCount,
    extraLength,
    feeAtomic,
    sizeBytes: asHex ? Math.floor(asHex.length / 2) : null,
    decoded: parsed
      ? buildDecodedMoneroTransaction({
          version,
          unlockTime,
          isCoinbase,
          inputsCount,
          outputsCount,
          extraLength,
          feeAtomic,
        })
      : null,
  };
}

// src/utils/stripLarge.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Options to control which large fields to strip from a Tendermint block-like object.
 */
export type StripOptions = {
  /** Drop evidence list (`block.evidence.evidence`). */
  dropEvidence?: boolean;
  /** Drop base64 tx list from `block.data.txs`. */
  dropTxs?: boolean;
};

/**
 * Returns a shallow-cloned copy of `obj` with optionally removed large/redundant fields.
 * Safe for unknown shapes; only touches known paths if present.
 * @param obj Object to strip fields from.
 * @param opts Flags that determine which fields to drop.
 */
export function stripLarge<T = unknown>(obj: T, opts: StripOptions = {}): T {
  if (!obj || typeof obj !== 'object') return obj;

  const out: any = Array.isArray(obj) ? [...(obj as any)] : { ...(obj as any) };

  if (out?.block?.evidence && opts.dropEvidence) {
    out.block = { ...out.block, evidence: { evidence: [] } };
  }

  if (out?.block?.data?.txs && opts.dropTxs) {
    out.block = { ...out.block, data: { ...out.block.data, txs: [] } };
  }

  return out as T;
}
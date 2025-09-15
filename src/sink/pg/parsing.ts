// src/sink/pg/parsing.ts

/**
 * Normalized representation of a tx log entry used by the sink.
 * @property {number} msg_index - Index of the message within the transaction (0-based). Use -1 when logs are not per-message.
 * @property {{ type: string; attributes: any }[]} events - Array of events with a type and raw attributes as returned by the node.
 */
export type NormalizedLog = {
  msg_index: number;
  events: Array<{ type: string; attributes: any }>;
};

/**
 * Returns the input value if it is an array, otherwise returns an empty array.
 * @template T
 * @param {*} x - Any value to normalize into an array.
 * @returns {T[]} The original array or an empty array if input was not an array.
 */
export function normArray<T>(x: any): T[] {
  return Array.isArray(x) ? x : [];
}

/**
 * Extracts the messages array from various transaction shapes (raw, decoded, or SDK-like).
 * Tries common paths: `tx.msgs`, `tx.messages`, `tx.body.messages`, `tx.decoded.body.messages`.
 * @param {*} tx - Transaction object in any supported shape.
 * @returns {any[]} Array of messages or an empty array if none found.
 */
export function pickMessages(tx: any): any[] {
  if (Array.isArray(tx?.msgs)) return tx.msgs;
  if (Array.isArray(tx?.messages)) return tx.messages;
  if (Array.isArray(tx?.body?.messages)) return tx.body.messages;
  if (Array.isArray(tx?.decoded?.body?.messages)) return tx.decoded?.body?.messages;
  return [];
}

/**
 * Extracts and normalizes logs from a transaction object.
 * Prefers `logsNormalized` if present; otherwise converts `tx.tx_response.logs` to {@link NormalizedLog}.
 * If only a flat `events` array exists, wraps it into a single {@link NormalizedLog} with `msg_index = -1`.
 * @param {*} tx - Transaction object in any supported shape.
 * @returns {NormalizedLog[]} Normalized logs array; empty array if none present.
 */
export function pickLogs(tx: any): NormalizedLog[] {
  if (Array.isArray(tx?.logsNormalized)) {
    return tx.logsNormalized as NormalizedLog[];
  }
  if (Array.isArray(tx?.tx_response?.logs)) {
    return tx.tx_response.logs.map((l: any) => ({
      msg_index: Number(l?.msg_index ?? -1),
      events: normArray(l?.events).map((ev: any) => ({
        type: String(ev?.type ?? 'unknown'),
        attributes: ev?.attributes ?? [],
      })),
    }));
  }
  const flat =
    (Array.isArray(tx?.eventsNormalized) && tx.eventsNormalized) || (Array.isArray(tx?.events) && tx.events) || null;

  if (Array.isArray(flat)) {
    return [
      {
        msg_index: -1,
        events: flat.map((ev: any) => ({
          type: String(ev?.type ?? 'unknown'),
          attributes: ev?.attributes ?? [],
        })),
      },
    ];
  }
  return [];
}

/**
 * Converts attributes into a uniform array of `{ key, value }` pairs.
 * Accepts either an array of `{key,value}` or a plain object map.
 * @param {*} attrs - Raw attributes.
 * @returns {{ key: string, value: (string|null) }[]} Normalized key/value pairs.
 */
export function attrsToPairs(attrs: any): Array<{ key: string; value: string | null }> {
  if (Array.isArray(attrs)) {
    return attrs.map((a) => ({
      key: String(a?.key ?? ''),
      value: a?.value != null ? String(a.value) : null,
    }));
  }
  if (attrs && typeof attrs === 'object') {
    return Object.entries(attrs).map(([k, v]) => ({
      key: String(k),
      value: v != null ? String(v as any) : null,
    }));
  }
  return [];
}

/**
 * Converts a value to a finite number or returns `null` if not convertible.
 * @param {*} x - Value to convert.
 * @returns {(number|null)} Finite number or `null`.
 */
export function toNum(x: any): number | null {
  if (x === null || x === undefined) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

/**
 * Builds a compact fee object from a decoded fee structure, copying only known fields.
 * Returned object may contain: `amount`, `gas_limit`, `payer`, `granter`.
 * @param {*} fee - Decoded fee object (e.g., from Tx.auth_info.fee).
 * @returns {(object|null)} Minimal fee object or `null` if nothing to copy.
 */
export function buildFeeFromDecodedFee(fee: any): any | null {
  if (!fee) return null;
  const out: any = {};
  if (fee.amount !== undefined) out.amount = fee.amount;
  if (fee.gas_limit !== undefined) out.gas_limit = fee.gas_limit;
  if (fee.payer !== undefined) out.payer = fee.payer;
  if (fee.granter !== undefined) out.granter = fee.granter;
  return Object.keys(out).length ? out : null;
}

/**
 * Collects potential signer addresses from a list of decoded messages.
 * Scans common fields like `signer`, `from_address`, `delegator_address`, `validator_address`, etc.
 * @param {any[]} msgs - Array of decoded messages.
 * @returns {(string[]|null)} Unique list of candidate addresses or `null` if none found.
 */
export function collectSignersFromMessages(msgs: any[]): string[] | null {
  const s = new Set<string>();
  for (const m of msgs) {
    const candidates = [
      m?.signer,
      m?.from_address,
      m?.delegator_address,
      m?.validator_address,
      m?.authority,
      m?.admin,
      m?.granter,
      m?.grantee,
      m?.sender,
      m?.creator,
    ];
    for (const c of candidates) {
      if (typeof c === 'string' && c.length >= 10) s.add(c);
    }
  }
  return s.size ? Array.from(s) : null;
}

/**
 * Parses a Cosmos SDK coin string of the form `${amount}${denom}` (e.g., "123uatom" or "42ibc/ABC123").
 * Denom allows letters and the characters `/:-` after the first char.
 * @param {(string|null|undefined)} amt - Coin string to parse.
 * @returns {{ denom: string, amount: string } | null} Parsed coin parts or `null` if input is invalid.
 */
export function parseCoin(amt: string | null | undefined): { denom: string; amount: string } | null {
  if (!amt) return null;
  const m = String(amt).match(/^(\d+)([a-zA-Z/][\w/:-]*)$/);
  if (!m || !m[1] || !m[2]) return null;
  return { amount: m[1], denom: m[2] };
}

/**
 * Finds an attribute value by key in an array of `{key,value}` pairs.
 * @param {{ key: string, value: (string|null) }[]} attrs - Attributes to search.
 * @param {string} key - Attribute key to find.
 * @returns {(string|null)} The attribute value or `null` if not present.
 */
export function findAttr(attrs: Array<{ key: string; value: string | null }>, key: string): string | null {
  const a = attrs.find((x) => x.key === key);
  return a ? (a.value ?? null) : null;
}

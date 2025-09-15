// src/normalize/events/normalize.ts
import type { AbciEvent, AbciEventAttr } from '../../types.js';
import { tryB64ToUtf8 } from './base64.js';

/**
 * Normalizes a single ABCI event attribute:
 * - Ensures key/value are strings
 * - Tries to Base64→UTF-8 decode both
 * - Preserves/infers the "index" flag (defaults to true)
 * @param a - Raw attribute-like input.
 * @returns Normalized attribute.
 */
export function normalizeAttr(a: any): AbciEventAttr {
  let key = a?.key ?? '';
  let value = a?.value ?? '';
  key = tryB64ToUtf8(String(key));
  value = tryB64ToUtf8(String(value));
  const index = a?.index ?? true;
  return { key, value, index };
}

/**
 * Normalizes a single ABCI event:
 * - Ensures type is a string
 * - Normalizes attributes array
 * @param e - Raw event-like input.
 * @returns Normalized event.
 */
export function normalizeEvent(e: any): AbciEvent {
  const type = String(e?.type ?? '');
  const attributesIn = Array.isArray(e?.attributes) ? e.attributes : [];
  const attributes = attributesIn.map(normalizeAttr);
  return { type, attributes };
}

/**
 * Normalizes an array of ABCI events.
 * @param evs - Raw events array.
 * @returns Normalized events array (empty when input is invalid).
 */
export function normalizeEvents(evs?: any[]): AbciEvent[] {
  if (!Array.isArray(evs)) return [];
  return evs.map(normalizeEvent);
}

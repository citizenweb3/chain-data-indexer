// src/normalize/events/base64.ts
/**
 * Utilities for base64 detection and UTF-8 decoding with safety checks.
 */

/**
 * Fast heuristic to check if a string "looks like" Base64 (length multiple of 4 and valid alphabet).
 * @param s - Candidate string.
 * @returns True if the string resembles Base64; otherwise false.
 */
export function looksLikeBase64(s: string): boolean {
  if (!s || s.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/=]+$/.test(s);
}

/**
 * Strict Base64 validator: verifies alphabet, padding and round-trip encoding.
 * @param s - Candidate string.
 * @returns True if the string is a canonical Base64 value; otherwise false.
 */
export function isCanonicalBase64(s: string): boolean {
  if (!s || s.length % 4 !== 0) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return false;
  try {
    const buf = Buffer.from(s, 'base64');
    const recoded = buf.toString('base64');
    return recoded === s;
  } catch {
    return false;
  }
}

/**
 * Attempts to decode canonical Base64 to UTF-8 text. If decoding fails or
 * decoded data looks non-textual, returns the original string.
 * @param s - Input string (possibly Base64).
 * @returns Decoded UTF-8 text, or the original string if decoding is unsafe.
 */
export function tryB64ToUtf8(s: string): string {
  if (!isCanonicalBase64(s)) return s;
  try {
    const bytes = Buffer.from(s, 'base64');
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const txt = decoder.decode(bytes);
    // Heuristic: allow common whitespace + printable ASCII + Unicode range
    if (!/^[\x09\x0A\x0D\x20-\x7E\u0080-\uFFFF]*$/.test(txt)) return s;
    return txt;
  } catch {
    return s;
  }
}

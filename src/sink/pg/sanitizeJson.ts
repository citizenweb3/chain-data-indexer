// src/sink/pg/sanitizeJson.ts

/**
 * Matches lone surrogate code units when a string contains raw UTF-16 data.
 */
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Matches lone surrogate escape sequences inside JSON text such as "\uDE2E".
 *
 * JSON.stringify emits lone surrogates as escaped text, not raw UTF-16 code
 * units. PostgreSQL JSONB rejects those escapes unless they form a valid pair.
 */
const ESCAPED_LONE_SURROGATE_RE =
  /\\u(?:d[89ab][0-9a-f]{2})(?!\\u(?:d[cdef][0-9a-f]{2}))|(?<!\\u(?:d[89ab][0-9a-f]{2}))\\u(?:d[cdef][0-9a-f]{2})/gi;

/**
 * Replaces lone Unicode surrogates in a string with the Unicode replacement
 * character (U+FFFD). This makes the string safe for PostgreSQL JSONB columns.
 *
 * Should be applied to the output of JSON.stringify before sending to PostgreSQL.
 *
 * @param json - A JSON string that may contain lone surrogates.
 * @returns The sanitized JSON string.
 */
export function sanitizeJsonSurrogates(json: string): string {
  return json.replace(LONE_SURROGATE_RE, '\uFFFD').replace(ESCAPED_LONE_SURROGATE_RE, '\\uFFFD');
}

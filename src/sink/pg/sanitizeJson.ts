// src/sink/pg/sanitizeJson.ts

/**
 * Regex that matches lone Unicode surrogates in a JSON-encoded string.
 *
 * After JSON.stringify, lone surrogates (U+D800..U+DFFF) appear as literal
 * escape sequences like \uD800 or \uDE2E. PostgreSQL JSONB rejects these
 * because the JSON spec requires surrogates to appear only as valid pairs
 * (high surrogate followed by low surrogate).
 *
 * This pattern matches:
 * - A high surrogate (\uD800..\uDBFF) NOT followed by a low surrogate
 * - A low surrogate (\uDC00..\uDFFF) NOT preceded by a high surrogate
 *
 * We operate on the raw JSON string where surrogates appear as literal
 * characters (not as \uXXXX escape text), because JSON.stringify in V8
 * outputs the actual surrogate code units, not escaped forms.
 */
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

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
  return json.replace(LONE_SURROGATE_RE, '\uFFFD');
}

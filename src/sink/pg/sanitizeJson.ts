// src/sink/pg/sanitizeJson.ts

const NULL_RE = /\u0000/g;

const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

const ESCAPED_NULL_RE = /\\u0000/gi;

const ESCAPED_LONE_SURROGATE_RE =
  /\\u(?:d[89ab][0-9a-f]{2})(?!\\u(?:d[cdef][0-9a-f]{2}))|(?<!\\u(?:d[89ab][0-9a-f]{2}))\\u(?:d[cdef][0-9a-f]{2})/gi;

/**
 * Makes a string safe for PostgreSQL text columns by replacing raw NUL bytes
 * and lone surrogate code units with U+FFFD.
 */
export function sanitizePgText(text: string): string {
  return text.replace(NULL_RE, '\uFFFD').replace(LONE_SURROGATE_RE, '\uFFFD');
}

/**
 * Makes JSON text safe for PostgreSQL JSONB by sanitizing raw text issues and
 * escaped sequences that PostgreSQL rejects during JSON parsing.
 */
export function sanitizePgJson(json: string): string {
  return sanitizePgText(json).replace(ESCAPED_NULL_RE, '\\uFFFD').replace(ESCAPED_LONE_SURROGATE_RE, '\\uFFFD');
}

export function sanitizeJsonSurrogates(json: string): string {
  return sanitizePgJson(json);
}

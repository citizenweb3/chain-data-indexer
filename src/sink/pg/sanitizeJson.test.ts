import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizePgJson, sanitizePgText } from './sanitizeJson.js';

test('sanitizePgText replaces raw NUL bytes', () => {
  assert.equal(sanitizePgText(`left${String.fromCharCode(0)}right`), 'left\uFFFDright');
  assert.equal(sanitizePgText('literal\\u0000'), 'literal\\u0000');
});

test('sanitizePgJson replaces escaped NUL and lone surrogate sequences', () => {
  const sanitized = sanitizePgJson('{"nul":"\\u0000","surrogate":"\\uD800","raw":"bad\u0000value"}');

  assert.equal(sanitized.includes('\\u0000'), false);
  assert.equal(sanitized.includes('\\uD800'), false);
  assert.equal(sanitized.includes('bad\u0000value'), false);
  assert.equal(sanitized.includes('\\uFFFD'), true);
});

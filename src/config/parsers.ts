// src/config/parsers.ts
import { LogLevel, PgMode } from '../types.js';

export function stripInlineComment(raw: string): string {
  let v = raw;
  const hashPos = v.indexOf('#');
  const semiPos = v.indexOf(';');
  let cutPos = -1;
  if (hashPos !== -1) cutPos = hashPos;
  if (semiPos !== -1 && (cutPos === -1 || semiPos < cutPos)) cutPos = semiPos;
  if (cutPos !== -1) v = v.slice(0, cutPos);
  return v.trim();
}

export function asInt(name: string, v: unknown, def?: number): number {
  if (v === undefined || v === null || v === '' || (typeof v === 'string' && v.toLowerCase() === 'undefined')) {
    if (def === undefined) throw new Error(`Missing required numeric option: ${name}`);
    return def;
  }
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error(`Option ${name} must be an integer, got "${v}"`);
  if (!Number.isSafeInteger(n)) throw new Error(`Option ${name} exceeds JS safe integer: ${n}`);
  return n;
}

export function asPositiveInt(name: string, v: unknown, def?: number): number {
  const n = asInt(name, v, def);
  if (n < 0) throw new Error(`Option ${name} must be >= 0, got ${n}`);
  return n;
}

export function asString(name: string, v: unknown, def?: string): string {
  if (v === undefined || v === null || v === '') {
    if (def === undefined) throw new Error(`Missing required option: ${name}`);
    return def;
  }
  return String(v);
}

export function asBool(name: string, v: unknown, def = false): boolean {
  if (v === undefined || v === null || v === '') return def;
  if (typeof v === 'boolean') return v;
  let s = String(v).trim();

  const isSingleQuoted = s.startsWith("'") && s.endsWith("'");
  const isDoubleQuoted = s.startsWith('"') && s.endsWith('"');
  if (isSingleQuoted || isDoubleQuoted) {
    s = s.slice(1, -1).trim();
  }

  s = stripInlineComment(s).toLowerCase();

  if (s === '1' || s === 'true' || s === 'yes' || s === 'y' || s === 'on') return true;
  if (s === '0' || s === 'false' || s === 'no' || s === 'n' || s === 'off') return false;

  throw new Error(`Option ${name} must be a boolean-like value, got "${v}"`);
}

export function asLogLevel(v: unknown, def: LogLevel = 'info'): LogLevel {
  const s = v === undefined || v === null || v === '' ? def : (String(v).toLowerCase() as LogLevel);
  return s === 'debug' ? 'debug' : 'info';
}

export function asPgMode(input: unknown): PgMode | undefined {
  if (input == null || input === false || input === '') return undefined;
  const raw = String(input).trim().toLowerCase().replace(/\s+/g, '-').replace(/_/g, '-');
  if (raw === 'batch-insert' || raw === 'block-atomic') return raw as PgMode;
  throw new Error(`pg-mode must be "batch-insert" or "block-atomic", got "${input}"`);
}

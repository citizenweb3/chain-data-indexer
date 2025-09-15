// src/config/dotenv.ts
import fs from 'node:fs';
import path from 'node:path';

/**
 * Lightweight .env loader. Loads key=value pairs from a .env file
 * in the current working directory into process.env if not already set.
 * - Supports both `KEY=VALUE` and `export KEY=VALUE` lines.
 * - Handles single/double quoted values.
 * - Strips inline comments (# or ;) for unquoted values.
 */
export function loadDotEnvIfPresent(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (let rawLine of lines) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice('export '.length).trim();

    const eq = line.indexOf('=');
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    const isSingleQuoted = value.startsWith("'") && value.endsWith("'");
    const isDoubleQuoted = value.startsWith('"') && value.endsWith('"');

    if (isSingleQuoted || isDoubleQuoted) {
      value = value.slice(1, -1);
    } else {
      const hashPos = value.indexOf('#');
      const semiPos = value.indexOf(';');
      let cutPos = -1;
      if (hashPos !== -1) cutPos = hashPos;
      if (semiPos !== -1 && (cutPos === -1 || semiPos < cutPos)) cutPos = semiPos;
      if (cutPos !== -1) value = value.slice(0, cutPos);
      value = value.trim();
    }

    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

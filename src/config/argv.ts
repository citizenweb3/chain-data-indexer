// src/config/argv.ts
import { ArgMap } from '../types.js';

/**
 * Parse CLI arguments of the form `--key=value` or `--flag`.
 * Unknown/positional args are ignored.
 */
export function parseArgv(argv = process.argv.slice(2)): ArgMap {
  const out: ArgMap = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    if (eq === -1) {
      out[body] = true;
    } else {
      const k = body.slice(0, eq);
      const v = body.slice(eq + 1);
      out[k] = v;
    }
  }
  return out;
}

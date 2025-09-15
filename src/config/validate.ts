// src/config/validate.ts
import { ZodError } from 'zod';
import { ConfigSchema } from './schema.ts';

export type ValidConfig = import('zod').infer<typeof ConfigSchema>;

/**
 * Format Zod validation errors into a compact, readable multi-line string.
 */
export function formatZodError(err: ZodError): string {
  return err.issues
    .map((issue) => {
      const path = issue.path.length ? issue.path.join('.') : '(root)';
      const base = `${path}: ${issue.message}`;
      const opts: unknown[] | undefined = (issue as any).options;
      if (Array.isArray(opts) && opts.length) {
        return `${base} (allowed: ${opts.join(', ')})`;
      }
      return base;
    })
    .join('\n');
}

/**
 * Validate a raw config object against the schema and return the typed result.
 * Throws an Error with a pretty message on failure.
 */
export function validateConfig(raw: unknown): ValidConfig {
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid configuration\n${formatZodError(parsed.error)}`);
  }
  return parsed.data;
}

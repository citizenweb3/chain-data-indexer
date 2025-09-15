// src/sink/pg/batch.ts
import type { PoolClient } from 'pg';
import { getLogger } from '../../utils/logger.js';

const log = getLogger('sink/pg/batch');

/**
 * Builds a multi-row INSERT SQL statement with positional parameters.
 *
 * @param table - The name of the target table to insert into.
 * @param columns - Array of column names for the insert.
 * @param rows - Array of row objects, each mapping column names to values.
 * @param conflictClause - SQL clause to handle conflicts (e.g., "ON CONFLICT ...").
 * @param types - Optional record mapping column names to PostgreSQL types (e.g., { col: 'jsonb' }).
 * @returns An object containing:
 *   - text: The parameterized SQL INSERT statement string.
 *   - values: Array of values in the order of positional parameters.
 */
export function makeMultiInsert(
  table: string,
  columns: string[],
  rows: any[],
  conflictClause: string,
  types?: Record<string, string>,
) {
  const values: any[] = [];
  const chunks: string[] = [];
  let p = 1;

  for (const r of rows) {
    const tuple: string[] = [];
    for (const c of columns) {
      values.push(r[c] ?? null);
      const cast = types?.[c] ? `::${types[c]}` : '';
      tuple.push(`$${p++}${cast}`);
    }
    chunks.push(`(${tuple.join(',')})`);
  }

  const text = `INSERT INTO ${table} (${columns.join(',')}) VALUES ${chunks.join(',')} ${conflictClause}`;
  return { text, values };
}

/**
 * Executes a multi-row INSERT in batches, honoring maximum row and parameter limits,
 * and safely casting JSONB values. Useful for inserting large datasets while avoiding
 * exceeding PostgreSQL parameter or row limits.
 *
 * @param client - The pg.PoolClient used to execute queries.
 * @param table - The name of the target table to insert into.
 * @param columns - Array of column names for the insert.
 * @param rows - Array of row objects, each mapping column names to values.
 * @param conflictClause - SQL clause to handle conflicts (e.g., "ON CONFLICT ...").
 * @param types - Optional record mapping column names to PostgreSQL types (e.g., { col: 'jsonb' }).
 * @param opts - Optional settings:
 *   - maxRows: Maximum number of rows per batch (default: 5000).
 *   - maxParams: Maximum number of parameters per batch (default: 30000).
 * @returns Promise that resolves when all batches have been inserted.
 */
export async function execBatchedInsert(
  client: PoolClient,
  table: string,
  columns: string[],
  rows: any[],
  conflictClause: string,
  types?: Record<string, string>,
  opts?: { maxRows?: number; maxParams?: number },
) {
  const maxRows = opts?.maxRows ?? 5_000;
  const maxParams = opts?.maxParams ?? 30_000;

  if (!rows.length) return;

  const prepped = !types
    ? rows
    : rows.map((r) => {
        const x: any = { ...r };
        for (const [col, t] of Object.entries(types)) {
          if (t === 'jsonb') {
            const v = x[col];
            if (v === null || v === undefined) {
              x[col] = null;
            } else if (typeof v === 'string') {
              x[col] = v; // предполагаем валидный JSON
            } else {
              x[col] = JSON.stringify(v, (_k, val) => {
                if (typeof val === 'bigint') return Number(val);
                if (val instanceof Uint8Array) return Buffer.from(val).toString('base64');
                if (Buffer.isBuffer(val)) return val.toString('base64');
                if (val instanceof Date) return val.toISOString();
                return val;
              });
            }
          }
        }
        return x;
      });

  for (let i = 0; i < prepped.length; ) {
    let count = 0;
    let params = 0;
    while (i + count < prepped.length) {
      const nextParams = params + columns.length;
      if (count >= maxRows || nextParams > maxParams) break;
      params = nextParams;
      count++;
    }
    const slice = prepped.slice(i, i + count);

    const { text, values } = makeMultiInsert(table, columns, slice, conflictClause, types);

    if (!values || values.length !== columns.length * slice.length) {
      throw new Error(
        `values/placeholder mismatch for ${table}: got ${values?.length} vs ${columns.length * slice.length}`,
      );
    }

    log.debug('exec batch', { table, slice: slice.length, params });
    await client.query(text, values);
    i += count;
  }
}

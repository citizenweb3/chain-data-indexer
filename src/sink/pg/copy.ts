import { createRequire } from 'node:module';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { PoolClient } from 'pg';
import { getLogger } from '../../utils/logger.js';

const require = createRequire(import.meta.url);
const { from: copyFrom } = require('pg-copy-streams') as { from: (sql: string) => unknown };
const log = getLogger('sink/pg/copy');

export type CopyColumn<Row> = {
  name: string;
  value: (row: Row) => unknown;
};

function stringifyCopyJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === 'bigint') return Number(item);
    if (item instanceof Uint8Array) return Buffer.from(item).toString('base64');
    if (Buffer.isBuffer(item)) return item.toString('base64');
    if (item instanceof Date) return item.toISOString();
    return item;
  });
}

function escapeCopyText(value: unknown): string {
  if (value === null || value === undefined) return '\\N';

  let text: string;
  if (typeof value === 'string') {
    text = value;
  } else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    text = String(value);
  } else if (value instanceof Date) {
    text = value.toISOString();
  } else {
    text = stringifyCopyJson(value);
  }

  return text.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

function* buildCopyLines<Row>(rows: Row[], columns: CopyColumn<Row>[]): Generator<string> {
  for (const row of rows) {
    const line = columns.map((column) => escapeCopyText(column.value(row))).join('\t');
    yield `${line}\n`;
  }
}

export async function execCopyFrom<Row>(
  client: PoolClient,
  table: string,
  columns: CopyColumn<Row>[],
  rows: Row[],
  opts?: { maxRows?: number },
): Promise<void> {
  const maxRows = opts?.maxRows ?? 10_000;

  if (!rows.length) return;

  const columnList = columns.map((column) => column.name).join(',');
  const sql = `COPY ${table} (${columnList}) FROM STDIN WITH (FORMAT text)`;

  for (let index = 0; index < rows.length; index += maxRows) {
    const slice = rows.slice(index, index + maxRows);
    const stream = client.query(copyFrom(sql) as never) as Writable;
    log.debug('exec copy batch', { table, slice: slice.length });
    await pipeline(Readable.from(buildCopyLines(slice, columns)), stream);
  }
}

export function dedupeCopyRows<Row>(rows: Row[], makeKey: (row: Row) => string): Row[] {
  const seen = new Set<string>();
  const deduped: Row[] = [];

  for (const row of rows) {
    const key = makeKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }

  return deduped;
}
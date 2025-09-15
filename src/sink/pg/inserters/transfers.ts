// src/sink/pg/inserters/transfers.ts
import type { PoolClient } from 'pg';
import { makeMultiInsert } from '../batch.ts';

/**
 * Inserts multiple transfer rows into the partitioned `bank.transfers` table.
 *
 * @param client - Active PostgreSQL PoolClient to run the query.
 * @param rows - Array of transfer rows to insert. Each row must match the columns order: tx_hash, msg_index, from_addr, to_addr, denom, amount, height.
 * @returns Promise<void> that resolves when insert is complete.
 * @remarks If rows is empty or undefined, the function returns early.
 */
export async function insertTransfers(client: PoolClient, rows: any[]): Promise<void> {
  if (!rows?.length) return;
  const cols = ['tx_hash', 'msg_index', 'from_addr', 'to_addr', 'denom', 'amount', 'height'];
  const { text, values } = makeMultiInsert(
    'bank.transfers',
    cols,
    rows,
    'ON CONFLICT (height, tx_hash, msg_index, from_addr, to_addr, denom) DO NOTHING',
  );
  await client.query(text, values);
}

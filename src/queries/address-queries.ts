import { db } from '@/db/indexer-db';
import { TEXT_ARRAY_OID } from '@/db/postgres-types';

export type EarliestActivitySource = 'actor' | 'transfer_out' | 'transfer_in';

export interface EarliestActivityRow {
  height: bigint;
  tx_index: number;
  tx_hash: string;
  time: Date;
  source: EarliestActivitySource;
}

export const queryEarliestActivity = async (address: string): Promise<EarliestActivityRow | null> => {
  const rows = await db<EarliestActivityRow[]>`
    WITH actor_matches AS MATERIALIZED (
      SELECT t.height, t.tx_index, t.tx_hash, t.time
      FROM core.transactions t
      WHERE t.signers && ${db.array([address], TEXT_ARRAY_OID)}
    ),
    candidates AS (
      (
        SELECT actor.height, actor.tx_index, actor.tx_hash, actor.time,
          'actor'::text AS source, 0 AS source_priority
        FROM actor_matches actor
        ORDER BY actor.height ASC, actor.tx_index ASC
        LIMIT 1
      )
      UNION ALL
      (
        SELECT DISTINCT t.height, t.tx_index, t.tx_hash, t.time,
          'transfer_out'::text AS source, 1 AS source_priority
        FROM bank.transfers transfer
        JOIN core.transactions t
          ON t.height = transfer.height AND t.tx_hash = transfer.tx_hash
        WHERE transfer.from_addr = ${address}
        ORDER BY t.height ASC, t.tx_index ASC, t.tx_hash ASC, t.time ASC
        LIMIT 1
      )
      UNION ALL
      (
        SELECT DISTINCT t.height, t.tx_index, t.tx_hash, t.time,
          'transfer_in'::text AS source, 2 AS source_priority
        FROM bank.transfers transfer
        JOIN core.transactions t
          ON t.height = transfer.height AND t.tx_hash = transfer.tx_hash
        WHERE transfer.to_addr = ${address}
        ORDER BY t.height ASC, t.tx_index ASC, t.tx_hash ASC, t.time ASC
        LIMIT 1
      )
    )
    SELECT height, tx_index, tx_hash, time, source
    FROM candidates
    ORDER BY height ASC, tx_index ASC, source_priority ASC
    LIMIT 1
  `;

  return rows[0] ?? null;
};

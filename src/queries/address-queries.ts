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

// `height + 0` deliberately prevents an ordered transaction scan from winning over the address
// indexes. Transfer transaction keys are deduplicated before the top-one ordering step.
export const queryEarliestActivity = async (address: string): Promise<EarliestActivityRow | null> => {
  const rows = await db<EarliestActivityRow[]>`
    WITH candidates AS (
      (
        SELECT t.height, t.tx_index, t.tx_hash, t.time,
          'actor'::text AS source, 0 AS source_priority
        FROM core.transactions t
        WHERE t.signers && ${db.array([address], TEXT_ARRAY_OID)}
        ORDER BY t.height + 0 ASC, t.tx_index ASC
        LIMIT 1
      )
      UNION ALL
      (
        SELECT deduped.height, deduped.tx_index, deduped.tx_hash, deduped.time,
          'transfer_out'::text AS source, 1 AS source_priority
        FROM (
          SELECT DISTINCT t.height, t.tx_index, t.tx_hash, t.time
          FROM bank.transfers transfer
          JOIN core.transactions t
            ON t.height = transfer.height AND t.tx_hash = transfer.tx_hash
          WHERE transfer.from_addr = ${address}
        ) deduped
        ORDER BY deduped.height + 0 ASC, deduped.tx_index ASC
        LIMIT 1
      )
      UNION ALL
      (
        SELECT deduped.height, deduped.tx_index, deduped.tx_hash, deduped.time,
          'transfer_in'::text AS source, 2 AS source_priority
        FROM (
          SELECT DISTINCT t.height, t.tx_index, t.tx_hash, t.time
          FROM bank.transfers transfer
          JOIN core.transactions t
            ON t.height = transfer.height AND t.tx_hash = transfer.tx_hash
          WHERE transfer.to_addr = ${address}
        ) deduped
        ORDER BY deduped.height + 0 ASC, deduped.tx_index ASC
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

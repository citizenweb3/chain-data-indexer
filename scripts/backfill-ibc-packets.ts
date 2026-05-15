import { config as loadDotEnv } from 'dotenv';
import { createPgPool, closePgPool } from '../src/db/pg.ts';
import { attrsToPairs } from '../src/sink/pg/parsing.ts';
import { extractIbcPacketRow, type IbcPacketUpsertRow } from '../src/sink/pg/ibcPackets.ts';
import { flushIbcPackets } from '../src/sink/pg/flushers/ibc_packets.ts';
import { getLogger } from '../src/utils/logger.ts';

loadDotEnv();

const log = getLogger('scripts/backfill-ibc-packets');

const EVENT_TYPES = ['send_packet', 'recv_packet', 'acknowledge_packet', 'timeout_packet', 'write_acknowledgement'];
const DEFAULT_BATCH_BLOCKS = 10_000;

type EventRow = {
  height: string | number;
  tx_hash: string;
  msg_index: number;
  event_index: number;
  event_type: string;
  attributes: unknown;
  signers: string[] | null;
};

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function firstSigner(signers: string[] | null): string | null {
  return Array.isArray(signers) && signers.length > 0 ? (signers[0] ?? null) : null;
}

async function resolveBackfillRange(
  pool: ReturnType<typeof createPgPool>,
): Promise<{ fromHeight: number; toHeight: number }> {
  const configuredFrom = process.env.IBC_BACKFILL_FROM_HEIGHT;
  const configuredTo = process.env.IBC_BACKFILL_TO_HEIGHT;

  const { rows } = await pool.query<{
    from_height: string | number | null;
    to_height: string | number | null;
  }>(
    `
    SELECT
      COALESCE($1::bigint, (
        SELECT max(height)
        FROM core.blocks
        WHERE time <= now() - interval '30 days'
      )) AS from_height,
      COALESCE($2::bigint, (SELECT max(height) FROM core.blocks)) AS to_height
  `,
    [configuredFrom ?? null, configuredTo ?? null],
  );

  const row = rows[0];
  const fromHeight = Number(row?.from_height ?? 0);
  const toHeight = Number(row?.to_height ?? 0);
  if (!Number.isFinite(fromHeight) || !Number.isFinite(toHeight) || fromHeight <= 0 || toHeight < fromHeight) {
    throw new Error(`invalid IBC backfill range: from=${fromHeight}, to=${toHeight}`);
  }

  return { fromHeight, toHeight };
}

async function main() {
  const pool = createPgPool({
    connectionString: process.env.PG_CONNECTION_STRING,
    host: process.env.PG_HOST ?? '127.0.0.1',
    port: Number(process.env.PG_PORT ?? 5432),
    user: process.env.PG_USER ?? 'cosmos_indexer_user',
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DB ?? 'cosmos_indexer_db',
    poolSize: Number(process.env.PG_POOL_SIZE ?? 4),
    applicationName: 'cosmos-indexer-ibc-backfill',
  });

  try {
    const batchBlocks = envInt('IBC_BACKFILL_BATCH_BLOCKS', DEFAULT_BATCH_BLOCKS);
    const { fromHeight, toHeight } = await resolveBackfillRange(pool);
    log.info('starting IBC packets backfill [%d, %d], batchBlocks=%d', fromHeight, toHeight, batchBlocks);

    for (let cursor = fromHeight - 1; cursor < toHeight; ) {
      const batchEnd = Math.min(cursor + batchBlocks, toHeight);
      const { rows } = await pool.query<EventRow>(
        `
          SELECT e.height, e.tx_hash, e.msg_index, e.event_index, e.event_type, e.attributes, t.signers
          FROM core.events e
          LEFT JOIN core.transactions t
            ON t.height = e.height
           AND t.tx_hash = e.tx_hash
          WHERE e.height > $1
            AND e.height <= $2
            AND e.event_type = ANY($3::text[])
          ORDER BY e.height, e.tx_hash, e.msg_index, e.event_index
        `,
        [cursor, batchEnd, EVENT_TYPES],
      );

      const ibcRows: IbcPacketUpsertRow[] = [];
      for (const event of rows) {
        const row = extractIbcPacketRow(attrsToPairs(event.attributes), {
          eventType: event.event_type,
          height: Number(event.height),
          txHash: event.tx_hash,
          relayer: firstSigner(event.signers),
        });
        if (row) ibcRows.push(row);
      }

      if (ibcRows.length > 0) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(`SET LOCAL statement_timeout = '10min'`);
          await flushIbcPackets(client, ibcRows);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      }

      log.info('backfilled [%d, %d]: events=%d ibc_packets=%d', cursor + 1, batchEnd, rows.length, ibcRows.length);
      cursor = batchEnd;
    }

    log.info('IBC packets backfill complete');
  } finally {
    await closePgPool();
  }
}

main().catch((err) => {
  log.error('IBC packets backfill failed', {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exitCode = 1;
});

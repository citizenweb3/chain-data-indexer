import assert from 'node:assert/strict';
import test from 'node:test';

import type { Client } from 'pg';

import { withDisposablePostgres } from '../helpers/postgres';

const utcDate = (daysAgo: number): Date => {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date;
};

const atUtcHour = (date: Date, hour: number): Date => {
  const result = new Date(date);
  result.setUTCHours(hour, 0, 0, 0);
  return result;
};

const seedReferenceData = async (client: Client, today: Date, yesterday: Date) => {
  await client.query(`
    INSERT INTO chains (name, display_name, chain_id) VALUES
      ('cosmoshub', 'Cosmos Hub', 'cosmoshub-4'),
      ('atomone', 'AtomOne', 'atomone-1')
    ON CONFLICT (name) DO NOTHING
  `);

  const assets = await client.query<{ id: number; native_denom: string }>(`
    INSERT INTO assets (symbol, coingecko_id, decimals, native_denom) VALUES
      ('ATOM', 'cosmos', 6, 'uatom'),
      ('ORAI', 'oraichain-token', 6, 'orai'),
      ('NOPRICE', 'no-price', 6, 'unoprice')
    RETURNING id, native_denom
  `);
  const assetIds = new Map(assets.rows.map((row) => [row.native_denom, row.id]));

  await client.query(
    `INSERT INTO price_history (asset_id, date, usd) VALUES
       ($1, $3, 2), ($1, $4, 2),
       ($2, $3, 0.25), ($2, $4, 0.25)`,
    [assetIds.get('uatom'), assetIds.get('orai'), yesterday, today],
  );
};

const seedPackets = async (client: Client, today: Date, yesterday: Date) => {
  const rows = [
    ['channel-0', '1', 'acknowledged', 'outgoing', atUtcHour(today, 1), 'uatom', '1000000'],
    ['channel-0', '2', 'sent', 'outgoing', atUtcHour(today, 2), 'uatom', '2000000'],
    ['channel-0', '3', 'timeout', 'outgoing', atUtcHour(today, 3), 'uatom', '3000000'],
    ['channel-1', '4', 'received', 'incoming', atUtcHour(yesterday, 4), 'orai', '1000000'],
    ['channel-1', '5', 'failed', 'incoming', atUtcHour(yesterday, 5), 'orai', '754974669602687'],
    ['channel-2', '6', 'received', 'incoming', atUtcHour(today, 6), 'ufoo', '1000000'],
    ['channel-2', '7', 'received', 'incoming', atUtcHour(today, 7), null, null],
    ['channel-2', '8', 'received', 'incoming', atUtcHour(today, 8), 'unoprice', '1000000'],
    ['channel-2', '9', 'received', 'incoming', atUtcHour(today, 9), 'uatom', null],
  ] as const;

  for (const [channel, sequence, status, direction, eventTime, denom, amount] of rows) {
    await client.query(
      `INSERT INTO ibc_packets (
         chain, channel_id_src, port_id_src, sequence, status, direction,
         event_height, event_time, denom, amount
       ) VALUES ('cosmoshub', $1, 'transfer', $2, $3, $4, $2, $5, $6, $7)`,
      [channel, sequence, status, direction, eventTime, denom, amount],
    );
  }
};

const readDailySnapshot = async (client: Client) => {
  const result = await client.query(`
    SELECT
      chain, date::text, channel_id_src, direction, denom,
      transfers_count::text, amount_native::text, amount_usd::text,
      eligible_packets::text, priced_packets::text, unpriced_packets::text,
      unpriced_denoms
    FROM ibc_daily_stats
    WHERE chain = 'cosmoshub'
    ORDER BY date, channel_id_src NULLS LAST, direction, denom NULLS LAST
  `);
  return result.rows;
};

test(
  'daily recompute replaces retained slices with delivered-only coverage atomically',
  { timeout: 30_000 },
  async () => {
    await withDisposablePostgres(async ({ databaseUrl, client }) => {
      process.env.DATABASE_URL = databaseUrl;
      const today = utcDate(0);
      const yesterday = utcDate(1);
      await seedReferenceData(client, today, yesterday);
      await seedPackets(client, today, yesterday);

      const [{ runRecomputeDailyStats }, { db }] = await Promise.all([
        import('../../server/jobs/recompute-daily-stats'),
        import('@/db'),
      ]);

      try {
        await runRecomputeDailyStats(['cosmoshub']);

        const globalCoverage = await client.query<{
          direction: string;
          eligible: string;
          priced: string;
          unpriced: string;
          denoms: string[];
        }>(`
          SELECT
            direction,
            SUM(eligible_packets)::text AS eligible,
            SUM(priced_packets)::text AS priced,
            SUM(unpriced_packets)::text AS unpriced,
            ARRAY(
              SELECT DISTINCT unnest_denom
              FROM ibc_daily_stats d2,
                   UNNEST(d2.unpriced_denoms) AS unnest_denom
              WHERE d2.chain = 'cosmoshub'
                AND d2.channel_id_src IS NULL
                AND d2.denom IS NULL
                AND d2.direction = d.direction
              ORDER BY unnest_denom
            ) AS denoms
          FROM ibc_daily_stats d
          WHERE chain = 'cosmoshub'
            AND channel_id_src IS NULL
            AND denom IS NULL
          GROUP BY direction
          ORDER BY direction
        `);
        assert.deepEqual(globalCoverage.rows, [
          {
            direction: 'incoming',
            eligible: '5',
            priced: '1',
            unpriced: '4',
            denoms: ['__unknown__', 'uatom', 'ufoo', 'unoprice'],
          },
          {
            direction: 'outgoing',
            eligible: '1',
            priced: '1',
            unpriced: '0',
            denoms: [],
          },
        ]);

        const orai = await client.query<{
          transfers: string;
          amount: string;
          usd: string;
        }>(`
          SELECT
            SUM(transfers_count)::text AS transfers,
            SUM(amount_native)::text AS amount,
            SUM(amount_usd)::text AS usd
          FROM ibc_daily_stats
          WHERE chain = 'cosmoshub'
            AND channel_id_src IS NULL
            AND direction = 'incoming'
            AND denom = 'orai'
        `);
        assert.deepEqual(orai.rows[0], {
          transfers: '1',
          amount: '1000000',
          usd: '0.25000000',
        });

        const state = await client.query<{
          version: number;
          corrected_from: string;
          last_recomputed_at: Date;
        }>(`
          SELECT version, corrected_from::text, last_recomputed_at
          FROM ibc_aggregate_states
          WHERE chain = 'cosmoshub'
        `);
        assert.equal(state.rows[0]?.version, 2);
        assert.equal(state.rows[0]?.corrected_from, yesterday.toISOString().slice(0, 10));
        assert.ok(state.rows[0]?.last_recomputed_at instanceof Date);

        const heartbeat = await client.query<{ updated_at: Date }>(`
          SELECT updated_at
          FROM sync_cursors
          WHERE chain = 'cosmoshub' AND key = 'recompute-daily-stats'
        `);
        assert.ok(heartbeat.rows[0]?.updated_at instanceof Date);

        await client.query(
          `INSERT INTO ibc_daily_stats (
             chain, date, channel_id_src, direction, denom, transfers_count,
             amount_native, amount_usd, recomputed_at
           ) VALUES ('cosmoshub', $1, 'channel-obsolete', 'outgoing', 'obsolete',
             1, 1, 1, NOW())`,
          [today],
        );
        await runRecomputeDailyStats(['cosmoshub']);
        const obsolete = await client.query<{ count: string }>(`
          SELECT COUNT(*)::text AS count
          FROM ibc_daily_stats
          WHERE chain = 'cosmoshub' AND denom = 'obsolete'
        `);
        assert.equal(obsolete.rows[0]?.count, '0');

        const beforeIdempotentRun = await readDailySnapshot(client);
        await runRecomputeDailyStats(['cosmoshub']);
        assert.deepEqual(await readDailySnapshot(client), beforeIdempotentRun);

        await client.query(`
          UPDATE ibc_packets
          SET status = 'acknowledged'
          WHERE chain = 'cosmoshub' AND sequence = 2
        `);
        await runRecomputeDailyStats(['cosmoshub']);
        const outgoing = await client.query<{ eligible: string; amount: string }>(`
          SELECT
            SUM(eligible_packets)::text AS eligible,
            SUM(amount_native)::text AS amount
          FROM ibc_daily_stats
          WHERE chain = 'cosmoshub'
            AND channel_id_src IS NULL
            AND direction = 'outgoing'
            AND denom = 'uatom'
        `);
        assert.deepEqual(outgoing.rows[0], { eligible: '2', amount: '3000000' });

        const beforeFailure = await readDailySnapshot(client);
        const stateBeforeFailure = await client.query<{ last_recomputed_at: string }>(`
          SELECT last_recomputed_at::text
          FROM ibc_aggregate_states
          WHERE chain = 'cosmoshub'
        `);
        await client.query(
          `ALTER FUNCTION resolve_base_denom(text) RENAME TO resolve_base_denom_unavailable`,
        );
        try {
          await runRecomputeDailyStats(['cosmoshub']);
        } finally {
          await client.query(
            `ALTER FUNCTION resolve_base_denom_unavailable(text) RENAME TO resolve_base_denom`,
          );
        }
        assert.deepEqual(await readDailySnapshot(client), beforeFailure);
        const stateAfterFailure = await client.query<{ last_recomputed_at: string }>(`
          SELECT last_recomputed_at::text
          FROM ibc_aggregate_states
          WHERE chain = 'cosmoshub'
        `);
        assert.deepEqual(stateAfterFailure.rows, stateBeforeFailure.rows);

        await runRecomputeDailyStats(['atomone']);
        const emptyState = await client.query<{
          version: number;
          corrected_from: string | null;
          recomputed: boolean;
          heartbeat: boolean;
        }>(`
          SELECT
            s.version,
            s.corrected_from::text,
            s.last_recomputed_at IS NOT NULL AS recomputed,
            c.updated_at IS NOT NULL AS heartbeat
          FROM ibc_aggregate_states s
          JOIN sync_cursors c
            ON c.chain = s.chain AND c.key = 'recompute-daily-stats'
          WHERE s.chain = 'atomone'
        `);
        assert.deepEqual(emptyState.rows[0], {
          version: 0,
          corrected_from: null,
          recomputed: true,
          heartbeat: true,
        });
      } finally {
        await db.$disconnect();
      }
    });
  },
);

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

const insertPacket = async (
  client: Client,
  packet: {
    chain: 'cosmoshub' | 'atomone';
    channel: string;
    sequence: number;
    status: string;
    direction: 'outgoing' | 'incoming';
    eventTime: Date;
    denom: string | null;
    amount: string | null;
  },
): Promise<void> => {
  await client.query(
    `INSERT INTO ibc_packets (
       chain, channel_id_src, port_id_src, sequence, status, direction,
       event_height, event_time, denom, amount
     ) VALUES ($1, $2, 'transfer', $3, $4, $5, $3, $6, $7, $8)`,
    [
      packet.chain,
      packet.channel,
      packet.sequence,
      packet.status,
      packet.direction,
      packet.eventTime,
      packet.denom,
      packet.amount,
    ],
  );
};

const seedFixture = async (client: Client): Promise<void> => {
  const today = utcDate(0);
  const day10 = utcDate(10);
  const day20 = utcDate(20);
  const day29 = utcDate(29);
  const recent = new Date(Date.now() - 60_000);

  await client.query(`
    INSERT INTO chains (name, display_name, chain_id) VALUES
      ('cosmoshub', 'Cosmos Hub', 'cosmoshub-4'),
      ('atomone', 'AtomOne', 'atomone-1')
    ON CONFLICT (name) DO NOTHING
  `);

  const assets = await client.query<{ id: number; native_denom: string }>(`
    INSERT INTO assets (symbol, coingecko_id, decimals, native_denom) VALUES
      ('ATOM', 'cosmos', 6, 'uatom'),
      ('ATONE', 'atomone', 6, 'uatone'),
      ('ORAI', 'oraichain-token', 6, 'orai')
    RETURNING id, native_denom
  `);
  const assetIds = new Map(assets.rows.map((row) => [row.native_denom, row.id]));
  const priceDates = [today, day10, day20, day29];
  for (const date of priceDates) {
    await client.query(
      `INSERT INTO price_history (asset_id, date, usd) VALUES
         ($1, $4, 2), ($2, $4, 3), ($3, $4, 0.25)
       ON CONFLICT (asset_id, date) DO NOTHING`,
      [assetIds.get('uatom'), assetIds.get('uatone'), assetIds.get('orai'), date],
    );
  }

  await insertPacket(client, {
    chain: 'cosmoshub',
    channel: 'channel-0',
    sequence: 1,
    status: 'acknowledged',
    direction: 'outgoing',
    eventTime: recent,
    denom: 'uatom',
    amount: '1000000',
  });
  await insertPacket(client, {
    chain: 'cosmoshub',
    channel: 'channel-0',
    sequence: 2,
    status: 'sent',
    direction: 'outgoing',
    eventTime: recent,
    denom: 'uatom',
    amount: '50000000',
  });
  await insertPacket(client, {
    chain: 'cosmoshub',
    channel: 'channel-1',
    sequence: 3,
    status: 'received',
    direction: 'incoming',
    eventTime: recent,
    denom: 'ufoo',
    amount: '1000000',
  });
  await insertPacket(client, {
    chain: 'cosmoshub',
    channel: 'channel-1',
    sequence: 4,
    status: 'failed',
    direction: 'incoming',
    eventTime: recent,
    denom: 'orai',
    amount: '754974669602687',
  });
  await insertPacket(client, {
    chain: 'cosmoshub',
    channel: 'channel-2',
    sequence: 5,
    status: 'acknowledged',
    direction: 'outgoing',
    eventTime: atUtcHour(day20, 4),
    denom: 'uatom',
    amount: '3000000',
  });
  await insertPacket(client, {
    chain: 'cosmoshub',
    channel: 'channel-2',
    sequence: 6,
    status: 'acknowledged',
    direction: 'outgoing',
    eventTime: atUtcHour(day29, 4),
    denom: 'uatom',
    amount: '5000000',
  });
  await insertPacket(client, {
    chain: 'atomone',
    channel: 'channel-10',
    sequence: 1,
    status: 'acknowledged',
    direction: 'outgoing',
    eventTime: recent,
    denom: 'uatone',
    amount: '2000000',
  });
  await insertPacket(client, {
    chain: 'atomone',
    channel: 'channel-10',
    sequence: 2,
    status: 'received',
    direction: 'incoming',
    eventTime: recent,
    denom: 'uatom',
    amount: '4000000',
  });
  await insertPacket(client, {
    chain: 'atomone',
    channel: 'channel-11',
    sequence: 3,
    status: 'acknowledged',
    direction: 'outgoing',
    eventTime: atUtcHour(day10, 4),
    denom: 'uatone',
    amount: '1000000',
  });
};

const assertCoverageIdentity = (status: {
  quality: string;
  coverage: {
    eligible_packets: number;
    priced_packets: number;
    unpriced_packets: number;
  } | null;
}): void => {
  assert.equal(status.quality, 'corrected');
  assert.ok(status.coverage);
  assert.equal(
    status.coverage.eligible_packets,
    status.coverage.priced_packets + status.coverage.unpriced_packets,
  );
};

test(
  'stats and timeseries expose delivered-only coverage, quality, freshness, and chain-native volume',
  { timeout: 30_000 },
  async () => {
    await withDisposablePostgres(async ({ databaseUrl, client }) => {
      process.env.DATABASE_URL = databaseUrl;
      await seedFixture(client);

      const [
        { runRecomputeDailyStats },
        { getStats },
        { getTimeseries },
        { StatsChainResponseSchema, StatsCombinedResponseSchema },
        { TimeseriesResponseSchema },
        combinedTimeseriesRoute,
        chainTimeseriesRoute,
        { db },
      ] = await Promise.all([
        import('../../server/jobs/recompute-daily-stats'),
        import('@/services/stats-service'),
        import('@/services/timeseries-service'),
        import('@/schemas/stats'),
        import('@/schemas/timeseries'),
        import('@/app/api/v1/timeseries/route'),
        import('@/app/api/v1/[chain]/timeseries/route'),
        import('@/db'),
      ]);

      try {
        await runRecomputeDailyStats(['cosmoshub', 'atomone']);
        await client.query(`
          INSERT INTO sync_cursors (chain, key, updated_at) VALUES
            ('cosmoshub', 'sync-ibc-transfers', NOW()),
            ('atomone', 'sync-ibc-transfers', NOW())
          ON CONFLICT (chain, key) DO UPDATE SET updated_at = EXCLUDED.updated_at
        `);

        const legacyDate = utcDate(60);
        await client.query(
          `INSERT INTO ibc_daily_stats (
             chain, date, channel_id_src, direction, denom, transfers_count,
             amount_native, amount_usd, recomputed_at
           ) VALUES
             ('cosmoshub', $1, NULL, 'outgoing', NULL, 7, NULL, NULL, NOW()),
             ('atomone', $1, NULL, 'outgoing', NULL, 11, NULL, NULL, NOW())`,
          [legacyDate],
        );

        const cosmosStats = await getStats({ direction: 'both', chain: 'cosmoshub' });
        StatsChainResponseSchema.parse({ data: cosmosStats });
        assert.equal(cosmosStats.native_denom, 'uatom');
        assert.equal(cosmosStats.native_symbol, 'ATOM');
        for (const window of ['24h', '7d', '30d'] as const) {
          assertCoverageIdentity(cosmosStats.coverage[window]);
        }
        assert.equal(cosmosStats.coverage['24h'].coverage?.eligible_packets, 2);
        assert.equal(cosmosStats.coverage['24h'].coverage?.priced_packets, 1);
        assert.deepEqual(cosmosStats.coverage['24h'].coverage?.unpriced_denoms, ['ufoo']);
        assert.ok(cosmosStats.sources[0]?.last_successful_sync_at);
        assert.equal(cosmosStats.as_of, cosmosStats.generated_at);

        const atomoneStats = await getStats({ direction: 'both', chain: 'atomone' });
        StatsChainResponseSchema.parse({ data: atomoneStats });
        assert.equal(atomoneStats.volume_native['7d'], '2');
        assert.equal(atomoneStats.volume_atom['7d'], '4');
        assert.equal(atomoneStats.native_denom, 'uatone');
        assert.equal(atomoneStats.native_symbol, 'ATONE');

        const combinedStats = await getStats({
          direction: 'both',
          chain: null,
          breakdown: 'chain',
        });
        StatsCombinedResponseSchema.parse({ data: combinedStats });
        assert.equal('volume_native' in combinedStats, false);
        assert.equal(combinedStats.transfers_count['24h'], 4);
        assert.equal(combinedStats.coverage['24h'].coverage?.eligible_packets, 4);
        assert.equal(combinedStats.coverage['24h'].coverage?.priced_packets, 3);
        assert.deepEqual(
          combinedStats.per_chain?.map((row) => [row.chain, row.native_symbol]),
          [
            ['cosmoshub', 'ATOM'],
            ['atomone', 'ATONE'],
          ],
        );

        const today = utcDate(0);
        const atomoneNative = await getTimeseries({
          metric: 'volume_native',
          direction: 'both',
          from: today,
          to: today,
          chain: 'atomone',
        });
        TimeseriesResponseSchema.parse(atomoneNative);
        assert.equal(atomoneNative.data[0]?.value, '2');
        assertCoverageIdentity(atomoneNative.data[0]!);

        const atomoneAtom = await getTimeseries({
          metric: 'volume_atom',
          direction: 'both',
          from: today,
          to: today,
          chain: 'atomone',
        });
        assert.equal(atomoneAtom.data[0]?.value, '4');

        const correctedDate = utcDate(20);
        const cosmosCorrected = await getTimeseries({
          metric: 'transfers',
          direction: 'both',
          from: correctedDate,
          to: correctedDate,
          chain: 'cosmoshub',
        });
        assert.equal(cosmosCorrected.data[0]?.value, '1');
        assertCoverageIdentity(cosmosCorrected.data[0]!);

        const combinedMixed = await getTimeseries({
          metric: 'transfers',
          direction: 'both',
          from: correctedDate,
          to: correctedDate,
          chain: null,
        });
        assert.equal(combinedMixed.data[0]?.quality, 'mixed');
        assert.equal(combinedMixed.data[0]?.coverage, null);

        const legacy = await getTimeseries({
          metric: 'transfers',
          direction: 'both',
          from: legacyDate,
          to: legacyDate,
          chain: 'cosmoshub',
        });
        assert.equal(legacy.data[0]?.value, '7');
        assert.equal(legacy.data[0]?.quality, 'legacy_unverified');
        assert.equal(legacy.data[0]?.coverage, null);

        const combinedNativeResponse = await combinedTimeseriesRoute.GET(
          new Request('http://localhost/api/v1/timeseries?metric=volume_native'),
        );
        assert.equal(combinedNativeResponse.status, 400);

        const chainNativeResponse = await chainTimeseriesRoute.GET(
          new Request('http://localhost/api/v1/atomone/timeseries?metric=volume_native'),
          { params: Promise.resolve({ chain: 'atomone' }) },
        );
        assert.equal(chainNativeResponse.status, 200);
        TimeseriesResponseSchema.parse(await chainNativeResponse.json());
      } finally {
        await db.$disconnect();
      }
    });
  },
);

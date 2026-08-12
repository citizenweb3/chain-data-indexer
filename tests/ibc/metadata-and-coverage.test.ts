import assert from 'node:assert/strict';
import test from 'node:test';

import { CHAIN_DISPLAY_NAMES, CHAIN_METADATA } from '@/lib/chains';
import { IbcCoverageStatusSchema } from '@/schemas/ibc-aggregation';
import {
  assertIbcCoverageIdentity,
  mergeIbcCoverageRows,
  normalizeUnpricedDenom,
  toIbcCoverageStatus,
} from '@/services/ibc-aggregation-coverage';
import {
  dailyCoverageSelectSql,
  DELIVERED_PACKET_SQL,
  PACKET_COVERAGE_SELECT_SQL,
  PRICED_PACKET_SQL,
  UNKNOWN_IBC_DENOM,
} from '@/services/ibc-aggregation-sql';
import { withDisposablePostgres } from '../helpers/postgres';

test('chain metadata keeps display compatibility and defines native units', () => {
  assert.equal(CHAIN_DISPLAY_NAMES.cosmoshub, 'Cosmos Hub');
  assert.equal(CHAIN_DISPLAY_NAMES.atomone, 'AtomOne');
  assert.deepEqual(CHAIN_METADATA.cosmoshub, {
    displayName: 'Cosmos Hub',
    nativeDenom: 'uatom',
    nativeSymbol: 'ATOM',
    nativeDecimals: 6,
  });
  assert.deepEqual(CHAIN_METADATA.atomone, {
    displayName: 'AtomOne',
    nativeDenom: 'uatone',
    nativeSymbol: 'ATONE',
    nativeDecimals: 6,
  });
});

test('coverage rows merge counts and deterministic unique denoms', () => {
  const counts = mergeIbcCoverageRows([
    {
      eligible_packets: BigInt(3),
      priced_packets: BigInt(2),
      unpriced_packets: BigInt(1),
      unpriced_denoms: ['uosmo'],
    },
    {
      eligible_packets: BigInt(2),
      priced_packets: BigInt(1),
      unpriced_packets: BigInt(1),
      unpriced_denoms: ['uatom', 'uosmo'],
    },
  ]);

  assert.deepEqual(counts, {
    eligiblePackets: BigInt(5),
    pricedPackets: BigInt(3),
    unpricedPackets: BigInt(2),
    unpricedDenoms: ['uatom', 'uosmo'],
  });
  assert.deepEqual(toIbcCoverageStatus('corrected', counts), {
    quality: 'corrected',
    coverage: {
      eligible_packets: 5,
      priced_packets: 3,
      unpriced_packets: 2,
      unpriced_denoms: ['uatom', 'uosmo'],
    },
  });
});

test('legacy and mixed coverage never fabricate packet counts', () => {
  assert.deepEqual(toIbcCoverageStatus('legacy_unverified'), {
    quality: 'legacy_unverified',
    coverage: null,
  });
  assert.deepEqual(toIbcCoverageStatus('mixed'), {
    quality: 'mixed',
    coverage: null,
  });
  assert.equal(normalizeUnpricedDenom(null), UNKNOWN_IBC_DENOM);
  assert.equal(normalizeUnpricedDenom('uatom'), 'uatom');
});

test('coverage identity and wire schema reject contradictory states', () => {
  assert.throws(
    () =>
      assertIbcCoverageIdentity({
        eligiblePackets: BigInt(4),
        pricedPackets: BigInt(1),
        unpricedPackets: BigInt(2),
        unpricedDenoms: [],
      }),
    /coverage invariant failed/,
  );
  assert.equal(
    IbcCoverageStatusSchema.safeParse({
      quality: 'legacy_unverified',
      coverage: {
        eligible_packets: 1,
        priced_packets: 1,
        unpriced_packets: 0,
        unpriced_denoms: [],
      },
    }).success,
    false,
  );
});

test('canonical SQL fragments encode delivered and priced predicates', () => {
  const deliveredSql = DELIVERED_PACKET_SQL.strings.join(' ');
  const pricedSql = PRICED_PACKET_SQL.strings.join(' ');
  const packetCoverageSql = PACKET_COVERAGE_SELECT_SQL.strings.join(' ');
  const dailyCoverageSql = dailyCoverageSelectSql().strings.join(' ');

  assert.match(deliveredSql, /outgoing/);
  assert.match(deliveredSql, /acknowledged/);
  assert.match(deliveredSql, /incoming/);
  assert.match(deliveredSql, /received/);
  assert.match(pricedSql, /p\.amount IS NOT NULL/);
  assert.match(pricedSql, /COALESCE\(ph\.usd, dsp\.usd\) IS NOT NULL/);
  assert.match(packetCoverageSql, /eligible_packets/);
  assert.match(packetCoverageSql, /unpriced_denoms/);
  assert.match(dailyCoverageSql, /SUM\(d\.eligible_packets\)/);
  assert.match(dailyCoverageSql, /FROM count_rows d2/);
});

test('disposable Postgres fixture deploys the repository migrations', async () => {
  await withDisposablePostgres(async ({ client }) => {
    const result = await client.query<{ packets: string | null; stats: string | null }>(
      `SELECT
         to_regclass('public.ibc_packets')::text AS packets,
         to_regclass('public.ibc_daily_stats')::text AS stats`,
    );
    assert.equal(result.rows[0]?.packets, 'ibc_packets');
    assert.equal(result.rows[0]?.stats, 'ibc_daily_stats');
  });
});

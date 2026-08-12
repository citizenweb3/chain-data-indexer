import { Prisma } from '@prisma/client';

export const UNKNOWN_IBC_DENOM = '__unknown__';

// Aggregate queries use `p` as the canonical ibc_packets alias. Keeping the
// lifecycle rule in one fragment prevents raw readers and the daily producer
// from drifting apart.
export const DELIVERED_PACKET_SQL = Prisma.sql`(
  (p.direction = 'outgoing' AND p.status = 'acknowledged')
  OR (p.direction = 'incoming' AND p.status = 'received')
)`;

export const RESOLVED_PACKET_DENOM_SQL = Prisma.sql`
  COALESCE(resolve_base_denom(p.denom), ${UNKNOWN_IBC_DENOM})
`;

// These aliases are shared deliberately by the producer and raw aggregate
// readers: `a` is assets, `ph` is price_history, and `dsp` is daily spot price.
export const PRICED_PACKET_SQL = Prisma.sql`(
  p.amount IS NOT NULL
  AND a.id IS NOT NULL
  AND COALESCE(ph.usd, dsp.usd) IS NOT NULL
)`;

// Raw aggregate queries share these exact coverage columns. The fragment
// deliberately assumes the canonical p/a/ph/dsp aliases documented above.
export const PACKET_COVERAGE_SELECT_SQL = Prisma.sql`
  COUNT(*)::bigint AS eligible_packets,
  COUNT(*) FILTER (WHERE ${PRICED_PACKET_SQL})::bigint AS priced_packets,
  COUNT(*) FILTER (WHERE NOT ${PRICED_PACKET_SQL})::bigint AS unpriced_packets,
  COALESCE(
    ARRAY_AGG(DISTINCT ${RESOLVED_PACKET_DENOM_SQL})
      FILTER (WHERE NOT ${PRICED_PACKET_SQL}),
    ARRAY[]::text[]
  ) AS unpriced_denoms
`;

// Daily readers name their coverage CTE `count_rows` and its aggregate alias
// `d`. Timeseries adds a correlated date filter; window readers omit it.
export const dailyCoverageSelectSql = (
  unpricedDenomFilter: Prisma.Sql = Prisma.empty,
): Prisma.Sql => Prisma.sql`
  COALESCE(SUM(d.eligible_packets), 0)::bigint AS eligible_packets,
  COALESCE(SUM(d.priced_packets), 0)::bigint AS priced_packets,
  COALESCE(SUM(d.unpriced_packets), 0)::bigint AS unpriced_packets,
  COALESCE(
    ARRAY(
      SELECT DISTINCT unpriced_denom
      FROM count_rows d2
      CROSS JOIN LATERAL UNNEST(d2.unpriced_denoms) AS unpriced_denom
      ${unpricedDenomFilter}
      ORDER BY unpriced_denom
    ),
    ARRAY[]::text[]
  ) AS unpriced_denoms
`;

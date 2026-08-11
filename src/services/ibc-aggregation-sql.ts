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

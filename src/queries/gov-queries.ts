import { db } from '@/db/indexer-db';

export interface GovVoteRow {
  proposal_id: bigint;
  option: string;
  weight: string | null;
  height: bigint;
  tx_hash: string;
}

// Final vote per proposal for one voter. gov.votes is append-only (re-votes => multiple
// rows), so the final vote is computed with DISTINCT ON (proposal_id) over ALL of the
// voter's rows (no cursor filter inside the CTE). The keyset cursor is applied on the
// OUTER query by proposal_id, matching the response order (proposal_id DESC).
export async function queryGovVotesByVoter(params: {
  voter: string;
  limit: number;
  beforeProposalId?: bigint;
}): Promise<GovVoteRow[]> {
  const { voter, limit, beforeProposalId } = params;
  const fetch = limit + 1;

  if (beforeProposalId !== undefined) {
    return db<GovVoteRow[]>`
      WITH final AS (
        SELECT DISTINCT ON (v.proposal_id)
               v.proposal_id, v.option, v.weight, v.height, v.tx_hash
        FROM gov.votes v
        WHERE v.voter = ${voter}
        ORDER BY v.proposal_id, v.height DESC, v.tx_hash DESC
      )
      SELECT proposal_id, option, weight, height, tx_hash
      FROM final
      WHERE proposal_id < ${beforeProposalId}
      ORDER BY proposal_id DESC
      LIMIT ${fetch}
    `;
  }

  return db<GovVoteRow[]>`
    WITH final AS (
      SELECT DISTINCT ON (v.proposal_id)
             v.proposal_id, v.option, v.weight, v.height, v.tx_hash
      FROM gov.votes v
      WHERE v.voter = ${voter}
      ORDER BY v.proposal_id, v.height DESC, v.tx_hash DESC
    )
    SELECT proposal_id, option, weight, height, tx_hash
    FROM final
    ORDER BY proposal_id DESC
    LIMIT ${fetch}
  `;
}

// Count of the DISTINCT (final-vote) set, not raw rows — re-votes must not inflate total.
// Bounded (a voter votes on few proposals) and index-assisted (idx_gov_votes_voter).
export async function queryGovVotesByVoterTotal(voter: string): Promise<bigint> {
  const rows = await db<[{ total: bigint }]>`
    SELECT COUNT(DISTINCT v.proposal_id)::bigint AS total
    FROM gov.votes v
    WHERE v.voter = ${voter}
  `;
  return rows[0]?.total ?? BigInt(0);
}

import {
  queryGovVotesByVoter,
  queryGovVotesByVoterTotal,
  type GovVoteRow,
} from '@/queries/gov-queries';

export type GovVoteOption = 'YES' | 'NO' | 'ABSTAIN' | 'VETO' | 'UNSPECIFIED';

export interface GovVoteDto {
  proposal_id: string;
  option: GovVoteOption;
  weight: string | null;
  height: string;
  tx_hash: string;
}

export interface GovVotesCursor {
  next_before_proposal_id: string;
}

export interface GovVotesByVoterResult {
  data: GovVoteDto[];
  cursor: GovVotesCursor | null;
  has_more: boolean;
  total: string;
}

// gov.votes.option is stored as the cosmos VoteOption enum serialized as text ('1'..'4'): the
// producer sink writes String(m.value.option) where option is the decoded numeric proto enum
// (normalize/gov.ts). The proto/codec string forms (VOTE_OPTION_YES / Yes) are also handled
// defensively in case a future decode path emits them. Cosmos VoteOption: 1=YES, 2=ABSTAIN,
// 3=NO, 4=NO_WITH_VETO ('0'/UNKNOWN/null → UNSPECIFIED) — note the 2/3 (ABSTAIN/NO) ordering.
// Normalize to a stable domain. Idempotent through VI's unifyVotes (which lowercases
// yes/no/abstain/veto). VETO never occurs on chains without the NoWithVeto option (e.g. AtomOne).
function normalizeOption(raw: string): GovVoteOption {
  switch (raw) {
    case '1':
    case 'Yes':
    case 'VOTE_OPTION_YES':
      return 'YES';
    case '3':
    case 'No':
    case 'VOTE_OPTION_NO':
      return 'NO';
    case '2':
    case 'Abstain':
    case 'VOTE_OPTION_ABSTAIN':
      return 'ABSTAIN';
    case '4':
    case 'NoWithVeto':
    case 'VOTE_OPTION_NO_WITH_VETO':
      return 'VETO';
    default:
      return 'UNSPECIFIED';
  }
}

function toDto(row: GovVoteRow): GovVoteDto {
  return {
    proposal_id: row.proposal_id.toString(),
    option: normalizeOption(row.option),
    weight: row.weight,
    height: row.height.toString(),
    tx_hash: row.tx_hash,
  };
}

export async function listGovVotesByVoter(params: {
  voter: string;
  limit: number;
  beforeProposalId?: bigint;
}): Promise<GovVotesByVoterResult> {
  const [rows, total] = await Promise.all([
    queryGovVotesByVoter(params),
    queryGovVotesByVoterTotal(params.voter),
  ]);

  const hasMore = rows.length > params.limit;
  const pageRows = hasMore ? rows.slice(0, params.limit) : rows;
  const data = pageRows.map(toDto);

  const last = pageRows.at(-1);
  const cursor: GovVotesCursor | null =
    hasMore && last !== undefined
      ? { next_before_proposal_id: last.proposal_id.toString() }
      : null;

  return { data, cursor, has_more: hasMore, total: total.toString() };
}

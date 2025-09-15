// src/normalize/gov.ts
export interface GovDepositRow {
  proposal_id: bigint;
  depositor: string;
  denom: string;
  amount: string; // as decimal string, PG NUMERIC
  height: number;
  tx_hash: string;
}

export interface GovVoteRow {
  proposal_id: bigint;
  voter: string;
  option: string;
  weight: string | null; // decimal weight for weighted, else null
  height: number;
  tx_hash: string;
}

export interface GovProposalRow {
  proposal_id: bigint;
  submitter: string | null;
  title: string | null;
  summary: string | null;
  proposal_type: string | null;
  status: 'deposit_period' | 'voting_period' | 'passed' | 'rejected' | 'failed' | 'withdrawn' | null;
  submit_time: Date | null;
}

export function extractGovFromBlock(params: {
  height: number;
  txHash: string;
  blockTime: Date;
  msgs: Array<{ type_url: string; value: any; signer?: string | null }>;
  eventsByMsg: Array<Array<{ type: string; attributes: Array<{ key: string; value: string }> }>>;
}): {
  deposits: GovDepositRow[];
  votes: GovVoteRow[];
  proposals: GovProposalRow[];
} {
  const deposits: GovDepositRow[] = [];
  const votes: GovVoteRow[] = [];
  const proposals: GovProposalRow[] = [];

  params.msgs.forEach((m, i) => {
    const type = m.type_url;

    // Deposits
    if (type === '/cosmos.gov.v1beta1.MsgDeposit' || type === '/cosmos.gov.v1.MsgDeposit') {
      const pid = BigInt(m.value?.proposal_id ?? 0);
      const depositor = m.value?.depositor ?? null;
      const coins: Array<{ denom: string; amount: string }> = m.value?.amount ?? [];
      if (pid > 0n && depositor && Array.isArray(coins)) {
        for (const c of coins) {
          deposits.push({
            proposal_id: pid,
            depositor,
            denom: String(c.denom ?? ''),
            amount: String(c.amount ?? '0'),
            height: params.height,
            tx_hash: params.txHash,
          });
        }
      }
    }

    // Votes
    if (type === '/cosmos.gov.v1beta1.MsgVote' || type === '/cosmos.gov.v1.MsgVote') {
      const pid = BigInt(m.value?.proposal_id ?? 0);
      const voter = m.value?.voter ?? null;

      // v1beta1 simple vote
      const simpleOption = m.value?.option ?? null;

      // v1 weighted
      const weighted: Array<{ option: string; weight: string }> | undefined = m.value?.options;

      if (pid > 0n && voter) {
        if (Array.isArray(weighted) && weighted.length > 0) {
          // choose a representation: store first option to `option`, weight to `weight`
          const first = weighted[0];
          votes.push({
            proposal_id: pid,
            voter,
            option: String(first?.option ?? 'UNKNOWN'),
            weight: String(first?.weight ?? '0'),
            height: params.height,
            tx_hash: params.txHash,
          });
        } else {
          votes.push({
            proposal_id: pid,
            voter,
            option: String(simpleOption ?? 'UNKNOWN'),
            weight: null,
            height: params.height,
            tx_hash: params.txHash,
          });
        }
      }
    }

    // Proposals
    if (type === '/cosmos.gov.v1beta1.MsgSubmitProposal' || type === '/cosmos.gov.v1.MsgSubmitProposal') {
      // Try to get proposal_id from events
      const evs = params.eventsByMsg[i] || [];
      let pid: bigint | null = null;
      for (const ev of evs) {
        if (ev.type === 'submit_proposal' || ev.type === 'proposal') {
          const idAttr = ev.attributes.find((a) => a.key === 'proposal_id');
          if (idAttr?.value) {
            const maybe = BigInt(idAttr.value);
            if (maybe > 0n) {
              pid = maybe;
              break;
            }
          }
        }
      }

      const submitter = m.signer ?? null;
      // Title/summary extraction differs between v1beta1 and v1 (metadata). Put best-effort:
      const content = m.value?.content || m.value?.messages?.[0]; // v1 might carry Any messages
      const title = content?.title ?? null;
      const summary = content?.description ?? content?.summary ?? null;
      const proposal_type = content?.['@type'] ?? null;

      if (pid) {
        proposals.push({
          proposal_id: pid,
          submitter,
          title: title ? String(title) : null,
          summary: summary ? String(summary) : null,
          proposal_type: proposal_type ? String(proposal_type) : null,
          status: 'deposit_period',
          submit_time: params.blockTime ?? null,
        });
      }
    }
  });

  return { deposits, votes, proposals };
}

// src/sink/pg/flushers/gov.ts
import { PoolClient } from 'pg';
import { execBatchedInsert } from '../batch.js';
import { dedupeCopyRows, execCopyFrom } from '../copy.js';

/**
 * Insert governance deposits in batches.
 *
 * @param client - Postgres client.
 * @param rows - Normalized deposit rows.
 */
export async function flushGovDeposits(
  client: PoolClient,
  rows: Array<{
    proposal_id: bigint;
    depositor: string;
    denom: string;
    amount: string;
    height: number;
    tx_hash: string;
  }>,
  opts?: { useCopy?: boolean },
) {
  if (!rows.length) return;
  if (opts?.useCopy) {
    const dedupedRows = dedupeCopyRows(
      rows,
      (row) => `${row.proposal_id}\x1f${row.depositor}\x1f${row.denom}\x1f${row.height}\x1f${row.tx_hash}`,
    );
    await execCopyFrom(
      client,
      'gov.deposits',
      [
        { name: 'proposal_id', value: (r) => r.proposal_id.toString() },
        { name: 'depositor', value: (r) => r.depositor },
        { name: 'denom', value: (r) => r.denom },
        { name: 'amount', value: (r) => r.amount },
        { name: 'height', value: (r) => r.height },
        { name: 'tx_hash', value: (r) => r.tx_hash },
      ],
      dedupedRows,
      { maxRows: 5000 },
    );
    return;
  }

  const columns = ['proposal_id', 'depositor', 'denom', 'amount', 'height', 'tx_hash'] as const;

  const shaped = rows.map((r) => ({
    proposal_id: r.proposal_id.toString(),
    depositor: r.depositor,
    denom: r.denom,
    amount: r.amount,
    height: r.height,
    tx_hash: r.tx_hash,
  }));

  await execBatchedInsert(client, 'gov.deposits', columns as unknown as string[], shaped, 'ON CONFLICT DO NOTHING');
}

/**
 * Insert governance votes in batches.
 *
 * For weighted votes, `weight` contains the decimal weight for the first option; for simple votes it is null.
 *
 * @param client - Postgres client.
 * @param rows - Normalized vote rows.
 */
export async function flushGovVotes(
  client: PoolClient,
  rows: Array<{
    proposal_id: bigint;
    voter: string;
    option: string;
    weight: string | null;
    height: number;
    tx_hash: string;
  }>,
  opts?: { useCopy?: boolean },
) {
  if (!rows.length) return;
  if (opts?.useCopy) {
    const dedupedRows = dedupeCopyRows(
      rows,
      (row) => `${row.proposal_id}\x1f${row.voter}\x1f${row.height}\x1f${row.tx_hash}`,
    );
    await execCopyFrom(
      client,
      'gov.votes',
      [
        { name: 'proposal_id', value: (r) => r.proposal_id.toString() },
        { name: 'voter', value: (r) => r.voter },
        { name: 'option', value: (r) => r.option },
        { name: 'weight', value: (r) => r.weight },
        { name: 'height', value: (r) => r.height },
        { name: 'tx_hash', value: (r) => r.tx_hash },
      ],
      dedupedRows,
      { maxRows: 5000 },
    );
    return;
  }

  const columns = ['proposal_id', 'voter', 'option', 'weight', 'height', 'tx_hash'] as const;

  const shaped = rows.map((r) => ({
    proposal_id: r.proposal_id.toString(),
    voter: r.voter,
    option: r.option,
    weight: r.weight,
    height: r.height,
    tx_hash: r.tx_hash,
  }));

  await execBatchedInsert(client, 'gov.votes', columns as unknown as string[], shaped, 'ON CONFLICT DO NOTHING');
}

/**
 * Upsert base information about proposals.
 *
 * This stores the basic record on submit (status is defaulted to 'deposit_period'
 * if not provided). Enrichment of status/lifecycle timestamps can be done later
 * by a background job.
 *
 * @param client - Postgres client.
 * @param rows - Proposal rows to upsert.
 */
export async function upsertGovProposals(
  client: PoolClient,
  rows: Array<{
    proposal_id: bigint;
    submitter: string | null;
    title: string | null;
    summary: string | null;
    proposal_type: string | null;
    status: string | null;
    submit_time: Date | null;
  }>,
) {
  if (!rows.length) return;

  const columns = ['proposal_id', 'submitter', 'title', 'summary', 'proposal_type', 'status', 'submit_time'] as const;

  const shaped = rows.map((r) => ({
    proposal_id: r.proposal_id.toString(),
    submitter: r.submitter,
    title: r.title,
    summary: r.summary,
    proposal_type: r.proposal_type,
    status: r.status ?? 'deposit_period',
    submit_time: r.submit_time ? r.submit_time.toISOString() : null,
  }));

  await execBatchedInsert(
    client,
    'gov.proposals',
    columns as unknown as string[],
    shaped,
    `ON CONFLICT (proposal_id) DO UPDATE SET
      submitter     = COALESCE(EXCLUDED.submitter, gov.proposals.submitter),
      title         = COALESCE(EXCLUDED.title, gov.proposals.title),
      summary       = COALESCE(EXCLUDED.summary, gov.proposals.summary),
      proposal_type = COALESCE(EXCLUDED.proposal_type, gov.proposals.proposal_type),
      submit_time   = COALESCE(EXCLUDED.submit_time, gov.proposals.submit_time)`,
  );
}

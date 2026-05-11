import assert from 'node:assert/strict';
import test from 'node:test';
import { dedupeGovProposalRows } from './gov.ts';

test('dedupeGovProposalRows merges duplicate proposal rows in one batch', () => {
  const rows = dedupeGovProposalRows([
    {
      proposal_id: 42n,
      submitter: 'cosmos1submitter',
      title: null,
      summary: 'summary from event path',
      proposal_type: null,
      status: 'deposit_period',
      submit_time: new Date('2026-04-15T11:00:05.000Z'),
    },
    {
      proposal_id: 42n,
      submitter: null,
      title: 'title from msg path',
      summary: null,
      proposal_type: '/cosmos.gov.v1beta1.TextProposal',
      status: null,
      submit_time: new Date('2026-04-15T11:00:00.000Z'),
    },
  ]);

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    proposal_id: 42n,
    submitter: 'cosmos1submitter',
    title: 'title from msg path',
    summary: 'summary from event path',
    proposal_type: '/cosmos.gov.v1beta1.TextProposal',
    status: 'deposit_period',
    submit_time: new Date('2026-04-15T11:00:00.000Z'),
  });
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { govVoteRowsFromTopMsg, normalizeVoteWeight, voteRowsFromMsg } from './votes.ts';

const VOTER = 'cosmos1validatoraccount';
const GRANTEE = 'cosmos1hotwalletgrantee';

test('normalizeVoteWeight rescales 18-decimal integer weights', () => {
  assert.equal(normalizeVoteWeight('1000000000000000000'), '1.000000000000000000');
  assert.equal(normalizeVoteWeight('500000000000000000'), '0.500000000000000000');
});

test('normalizeVoteWeight passes decimal strings through and handles zero/empty', () => {
  assert.equal(normalizeVoteWeight('0.5'), '0.5');
  assert.equal(normalizeVoteWeight('1.000000000000000000'), '1.000000000000000000');
  assert.equal(normalizeVoteWeight('0'), '0');
  assert.equal(normalizeVoteWeight(undefined), '0');
});

test('voteRowsFromMsg returns one row for a simple vote, none without voter/proposal', () => {
  const rows = voteRowsFromMsg({ '@type': '/cosmos.gov.v1.MsgVote', proposal_id: '42', voter: VOTER, option: 'VOTE_OPTION_YES' }, 100, 'HASH');
  assert.deepEqual(rows, [{ proposal_id: 42n, voter: VOTER, option: 'VOTE_OPTION_YES', weight: null, height: 100, tx_hash: 'HASH' }]);

  assert.deepEqual(voteRowsFromMsg({ '@type': '/cosmos.gov.v1.MsgVote', proposal_id: '42', option: 'VOTE_OPTION_YES' }, 100, 'HASH'), []);
  assert.deepEqual(voteRowsFromMsg({ '@type': '/cosmos.gov.v1.MsgVote', proposal_id: '0', voter: VOTER, option: 'VOTE_OPTION_YES' }, 100, 'HASH'), []);
});

test('voteRowsFromMsg emits one row per weighted option with normalized weights', () => {
  const rows = voteRowsFromMsg(
    {
      '@type': '/cosmos.gov.v1.MsgVoteWeighted',
      proposal_id: '7',
      voter: VOTER,
      options: [
        { option: 'VOTE_OPTION_YES', weight: '700000000000000000' },
        { option: 'VOTE_OPTION_ABSTAIN', weight: '0.3' },
      ],
    },
    100,
    'HASH',
  );
  assert.deepEqual(rows, [
    { proposal_id: 7n, voter: VOTER, option: 'VOTE_OPTION_YES', weight: '0.700000000000000000', height: 100, tx_hash: 'HASH' },
    { proposal_id: 7n, voter: VOTER, option: 'VOTE_OPTION_ABSTAIN', weight: '0.3', height: 100, tx_hash: 'HASH' },
  ]);
});

test('govVoteRowsFromTopMsg extracts a direct vote on a successful tx', () => {
  const rows = govVoteRowsFromTopMsg({ '@type': '/cosmos.gov.v1.MsgVote', proposal_id: '42', voter: VOTER, option: 'VOTE_OPTION_NO' }, 0, 100, 'HASH');
  assert.deepEqual(rows, [{ proposal_id: 42n, voter: VOTER, option: 'VOTE_OPTION_NO', weight: null, height: 100, tx_hash: 'HASH' }]);
});

test('govVoteRowsFromTopMsg drops votes from a failed tx (direct and authz)', () => {
  const direct = { '@type': '/cosmos.gov.v1.MsgVote', proposal_id: '42', voter: VOTER, option: 'VOTE_OPTION_YES' };
  assert.deepEqual(govVoteRowsFromTopMsg(direct, 1, 100, 'HASH'), []);

  const authz = {
    '@type': '/cosmos.authz.v1beta1.MsgExec',
    grantee: GRANTEE,
    msgs: [{ '@type': '/cosmos.gov.v1.MsgVote', proposal_id: '42', voter: VOTER, option: 'VOTE_OPTION_YES' }],
  };
  assert.deepEqual(govVoteRowsFromTopMsg(authz, 11, 100, 'HASH'), []);
});

test('govVoteRowsFromTopMsg unwraps an authz MsgExec vote using the inner (validator) voter', () => {
  const authz = {
    '@type': '/cosmos.authz.v1.MsgExec',
    grantee: GRANTEE,
    msgs: [{ '@type': '/cosmos.gov.v1.MsgVote', proposal_id: '99', voter: VOTER, option: 'VOTE_OPTION_YES' }],
  };
  const rows = govVoteRowsFromTopMsg(authz, 0, 250, 'EXECHASH');
  assert.deepEqual(rows, [{ proposal_id: 99n, voter: VOTER, option: 'VOTE_OPTION_YES', weight: null, height: 250, tx_hash: 'EXECHASH' }]);
});

test('govVoteRowsFromTopMsg unwraps weighted authz votes and ignores non-vote inner messages', () => {
  const authz = {
    '@type': '/cosmos.authz.v1beta1.MsgExec',
    grantee: GRANTEE,
    msgs: [
      { '@type': '/cosmos.bank.v1beta1.MsgSend', from_address: GRANTEE },
      {
        '@type': '/cosmos.gov.v1.MsgVoteWeighted',
        proposal_id: '5',
        voter: VOTER,
        options: [
          { option: 'VOTE_OPTION_YES', weight: '1000000000000000000' },
        ],
      },
    ],
  };
  const rows = govVoteRowsFromTopMsg(authz, 0, 300, 'HASH');
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { proposal_id: 5n, voter: VOTER, option: 'VOTE_OPTION_YES', weight: '1.000000000000000000', height: 300, tx_hash: 'HASH' });
});

test('govVoteRowsFromTopMsg returns nothing for unrelated messages', () => {
  assert.deepEqual(govVoteRowsFromTopMsg({ '@type': '/cosmos.bank.v1beta1.MsgSend' }, 0, 100, 'HASH'), []);
});

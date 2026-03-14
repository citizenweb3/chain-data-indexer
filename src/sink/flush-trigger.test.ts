import assert from 'node:assert/strict';
import test from 'node:test';

import { getTriggeredFlushBuffers } from './flush-trigger.js';

test('getTriggeredFlushBuffers returns every buffer that crossed its threshold', () => {
  const triggeredBy = getTriggeredFlushBuffers(
    {
      blocks: 1000,
      txs: 6000,
      msgs: 1200,
      events: 59_999,
      attrs: 180_000,
    },
    {
      blocks: 1000,
      txs: 6000,
      msgs: 18_000,
      events: 60_000,
      attrs: 180_000,
    },
  );

  assert.deepEqual(triggeredBy, ['blocks', 'txs', 'attrs']);
});

test('getTriggeredFlushBuffers ignores keys without a positive threshold', () => {
  const triggeredBy = getTriggeredFlushBuffers(
    {
      blocks: 10,
      txs: 0,
      govVotes: 50,
    },
    {
      blocks: 1000,
      txs: undefined,
      govVotes: 0,
    },
  );

  assert.deepEqual(triggeredBy, []);
});

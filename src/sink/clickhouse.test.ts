import assert from 'node:assert/strict';
import test from 'node:test';

import type { SinkConfig } from './types.js';
import { ClickHouseSink } from './clickhouse.js';

type InsertCall = {
  table: string;
  values: Record<string, unknown>[];
  format: 'JSONEachRow';
};

type QueryCall = {
  query: string;
  format: 'JSONEachRow';
};

type MockClientOptions = {
  insertHook?: (callIndex: number, params: InsertCall) => void | Promise<void>;
};

type MockClickHouseClient = {
  pingCalls: number;
  insertCalls: InsertCall[];
  queryCalls: QueryCall[];
  closeCalls: number;
  ping: () => Promise<{ success: true }>;
  insert: (params: InsertCall) => Promise<void>;
  query: (params: QueryCall) => Promise<{ json: () => Promise<Array<Record<string, unknown>>> }>;
  close: () => Promise<void>;
};

function createMockClient(maxHeight: unknown = 42, options?: MockClientOptions): MockClickHouseClient {
  const insertCalls: InsertCall[] = [];
  const queryCalls: QueryCall[] = [];

  const client: MockClickHouseClient = {
    pingCalls: 0,
    insertCalls,
    queryCalls,
    closeCalls: 0,
    ping: async () => {
      client.pingCalls += 1;
      return { success: true };
    },
    insert: async (params) => {
      insertCalls.push(params);
      await options?.insertHook?.(insertCalls.length, params);
    },
    query: async (params) => {
      queryCalls.push(params);
      return {
        json: async () => [{ max_height: maxHeight }],
      };
    },
    close: async () => {
      client.closeCalls += 1;
    },
  };

  return client;
}

function createSink(options?: {
  batchSizes?: SinkConfig['batchSizes'];
  maxHeight?: unknown;
  insertHook?: MockClientOptions['insertHook'];
}): {
  sink: ClickHouseSink;
  client: MockClickHouseClient;
  createClientCalls: Array<Record<string, unknown>>;
} {
  const client = createMockClient(options?.maxHeight, { insertHook: options?.insertHook });
  const createClientCalls: Array<Record<string, unknown>> = [];
  const cfg = {
    kind: 'clickhouse',
    batchSizes: options?.batchSizes,
    clickhouse: {
      url: 'http://localhost:8123',
      database: 'cdi',
      createClient: (clientConfig: Record<string, unknown>) => {
        createClientCalls.push(clientConfig);
        return client;
      },
    },
  } as SinkConfig & {
    clickhouse: {
      url: string;
      database: string;
      createClient: (clientConfig: Record<string, unknown>) => MockClickHouseClient;
    };
  };

  return {
    sink: new ClickHouseSink(cfg),
    client,
    createClientCalls,
  };
}

function buildMinimalBlock(height = 17): Record<string, unknown> {
  return {
    meta: {
      height,
      time: '2024-02-03T04:05:06.000Z',
    },
    block: {
      block_id: { hash: `BLOCK-${height}` },
      block: {
        size: 128,
        last_commit: {
          signatures: [],
          block_id: { hash: `COMMIT-${height}` },
        },
        data: { hash: `DATA-${height}` },
        evidence: { evidence: [] },
        header: { app_hash: `APP-${height}` },
      },
    },
    txs: [],
  };
}

function buildComplexBlock(height = 123): Record<string, unknown> {
  return {
    meta: {
      height,
      time: '2024-01-02T03:04:05.000Z',
    },
    block: {
      block_id: { hash: `BLOCK-${height}` },
      block: {
        size: 512,
        last_commit: {
          signatures: [{ validator_address: 'cosmosvalcons1proposer000000000000000000000000' }],
          block_id: { hash: `COMMIT-${height}` },
        },
        data: { hash: `DATA-${height}` },
        evidence: { evidence: [{ id: 1 }, { id: 2 }] },
        header: { app_hash: `APP-${height}` },
      },
    },
    txs: [
      {
        hash: `TX-${height}`,
        index: 0,
        code: 0,
        gas_wanted: '1000',
        gas_used: '900',
        fee: {
          amount: [{ amount: '5', denom: 'uatom' }],
          payer: 'cosmos1payer000000000000000000000000000000000',
        },
        memo: 'unit-test',
        raw_tx: {
          body_bytes: 'abc',
          auth_info_bytes: 'def',
        },
        decoded: {
          body: {
            memo: 'unit-test',
            messages: [
              {
                '@type': '/cosmwasm.wasm.v1.MsgExecuteContract',
                sender: 'cosmos1sender0000000000000000000000000000000',
                contract: 'wasm1contract000000000000000000000000000000',
                funds: [{ amount: '7', denom: 'uatom' }],
                msg: {
                  transfer: {
                    recipient: 'cosmos1recipient000000000000000000000000000',
                  },
                },
              },
            ],
          },
        },
        tx_response: {
          raw_log: 'ok',
          logs: [
            {
              msg_index: 0,
              events: [
                {
                  type: 'transfer',
                  attributes: [
                    { key: 'sender', value: 'cosmos1sender0000000000000000000000000000000' },
                    { key: 'recipient', value: 'cosmos1recipient000000000000000000000000000' },
                    { key: 'amount', value: '100uatom' },
                  ],
                },
                {
                  type: 'delegate',
                  attributes: [
                    { key: 'delegator', value: 'cosmos1sender0000000000000000000000000000000' },
                    { key: 'validator', value: 'cosmosvaloper1validator000000000000000000000' },
                    { key: 'amount', value: '200ustake' },
                  ],
                },
                {
                  type: 'withdraw_rewards',
                  attributes: [
                    { key: 'delegator', value: 'cosmos1sender0000000000000000000000000000000' },
                    { key: 'validator', value: 'cosmosvaloper1validator000000000000000000000' },
                    { key: 'withdraw_address', value: 'cosmos1withdraw000000000000000000000000000' },
                    { key: 'amount', value: '25ustake' },
                  ],
                },
                {
                  type: 'wasm',
                  attributes: [
                    { key: '_contract_address', value: 'wasm1contract000000000000000000000000000000' },
                    { key: 'action', value: 'swap' },
                  ],
                },
              ],
            },
          ],
        },
      },
    ],
    gov: {
      deposits: [
        {
          proposal_id: 7n,
          depositor: 'cosmos1depositor0000000000000000000000000000',
          denom: 'uatom',
          amount: '20',
          height,
          tx_hash: `TX-${height}`,
        },
      ],
      votes: [
        {
          proposal_id: 7n,
          voter: 'cosmos1voter000000000000000000000000000000000',
          option: 'yes',
          weight: null,
          height,
          tx_hash: `TX-${height}`,
        },
      ],
      proposals: [
        {
          proposal_id: 7n,
          submitter: 'cosmos1submitter0000000000000000000000000000',
          title: 'Proposal title',
          summary: 'Proposal summary',
          proposal_type: 'text',
          status: null,
          submit_time: new Date('2024-01-01T00:00:00.000Z'),
        },
      ],
    },
  };
}

test('init pings the client and getMaxHeight returns the queried height', async () => {
  const { sink, client } = createSink({ maxHeight: '42' });

  await sink.init();

  assert.equal(client.pingCalls, 1);
  assert.equal(await sink.getMaxHeight(), 42);
  assert.deepEqual(client.queryCalls, [
    {
      query: 'SELECT max(height) AS max_height FROM core.blocks',
      format: 'JSONEachRow',
    },
  ]);

  await sink.close();
});

test('init configures the client to accept ISO timestamps for DateTime64 columns', async () => {
  const { sink, createClientCalls } = createSink();

  await sink.init();

  assert.deepEqual(createClientCalls[0]?.clickhouse_settings, {
    date_time_input_format: 'best_effort',
  });

  await sink.close();
});

test('write serializes values and flushes buffers in postgres order once a threshold trips', async () => {
  const { sink, client } = createSink({
    batchSizes: {
      blocks: 1,
      txs: 1,
      msgs: 1,
      events: 1,
      attrs: 1,
      transfers: 1,
      stakeDeleg: 1,
      stakeDistr: 1,
      wasmExec: 1,
      wasmEvents: 1,
      govDeposits: 1,
      govVotes: 1,
      govProposals: 1,
    },
  });

  await sink.init();
  await sink.write(buildComplexBlock());

  assert.deepEqual(
    client.insertCalls.map((call) => call.table),
    [
      'core.blocks',
      'core.transactions',
      'core.messages',
      'core.events',
      'core.event_attrs',
      'bank.transfers',
      'stake.delegation_events',
      'stake.distribution_events',
      'wasm.executions',
      'wasm.events',
      'gov.deposits',
      'gov.votes',
      'gov.proposals',
    ],
  );

  const blocksInsert = client.insertCalls[0];
  assert.ok(blocksInsert);
  assert.equal(blocksInsert.values[0]?.time, '2024-01-02T03:04:05.000Z');

  const txsInsert = client.insertCalls[1];
  assert.ok(txsInsert);
  assert.deepEqual(txsInsert.values[0]?.signers, ['cosmos1sender0000000000000000000000000000000']);
  assert.equal(
    txsInsert.values[0]?.fee,
    JSON.stringify({
      amount: [{ amount: '5', denom: 'uatom' }],
      payer: 'cosmos1payer000000000000000000000000000000000',
    }),
  );
  assert.equal(
    txsInsert.values[0]?.raw_tx,
    JSON.stringify({
      body_bytes: 'abc',
      auth_info_bytes: 'def',
    }),
  );

  const msgsInsert = client.insertCalls[2];
  assert.ok(msgsInsert);
  assert.equal(
    msgsInsert.values[0]?.value,
    JSON.stringify({
      '@type': '/cosmwasm.wasm.v1.MsgExecuteContract',
      sender: 'cosmos1sender0000000000000000000000000000000',
      contract: 'wasm1contract000000000000000000000000000000',
      funds: [{ amount: '7', denom: 'uatom' }],
      msg: {
        transfer: {
          recipient: 'cosmos1recipient000000000000000000000000000',
        },
      },
    }),
  );

  const eventsInsert = client.insertCalls[3];
  assert.ok(eventsInsert);
  assert.deepEqual(eventsInsert.values[0]?.attributes, [
    { key: 'sender', value: 'cosmos1sender0000000000000000000000000000000' },
    { key: 'recipient', value: 'cosmos1recipient000000000000000000000000000' },
    { key: 'amount', value: '100uatom' },
  ]);

  const govDepositsInsert = client.insertCalls[10];
  assert.ok(govDepositsInsert);
  assert.equal(govDepositsInsert.values[0]?.proposal_id, '7');

  const govProposalsInsert = client.insertCalls[12];
  assert.ok(govProposalsInsert);
  assert.equal(govProposalsInsert.values[0]?.proposal_id, '7');
  assert.equal(govProposalsInsert.values[0]?.status, 'deposit_period');
  assert.equal(govProposalsInsert.values[0]?.submit_time, '2024-01-01T00:00:00.000Z');

  await sink.close();
});

test('write ignores invalid input and flush drains buffered rows from parsed JSON strings', async () => {
  const { sink, client } = createSink({
    batchSizes: {
      blocks: 10,
    },
  });

  await sink.init();
  await sink.write('not-json');
  await sink.write({ error: 'skip this row' });
  await sink.write('{"error":"skip this row"}');
  await sink.write(JSON.stringify(buildMinimalBlock(88)));

  assert.equal(client.insertCalls.length, 0);

  await sink.flush();

  assert.deepEqual(client.insertCalls.map((call) => call.table), ['core.blocks']);
  assert.equal(client.insertCalls[0]?.values[0]?.height, 88);

  await sink.close();
});

test('close flushes pending rows and closes the client once', async () => {
  const { sink, client } = createSink({
    batchSizes: {
      blocks: 10,
    },
  });

  await sink.init();
  await sink.write(buildMinimalBlock(99));
  await sink.close();
  await sink.close();

  assert.deepEqual(client.insertCalls.map((call) => call.table), ['core.blocks']);
  assert.equal(client.closeCalls, 1);
});

test('flush retries all buffered tables after a partial insert failure', async () => {
  const failureState: { failOnCall?: number } = { failOnCall: 2 };
  const { sink, client } = createSink({
    batchSizes: {
      blocks: 1,
      txs: 1,
      msgs: 1,
      events: 1,
      attrs: 1,
      transfers: 1,
      stakeDeleg: 1,
      stakeDistr: 1,
      wasmExec: 1,
      wasmEvents: 1,
      govDeposits: 1,
      govVotes: 1,
      govProposals: 1,
    },
    insertHook: async (callIndex) => {
      if (callIndex === failureState.failOnCall) {
        throw new Error('insert failed');
      }
    },
  });

  await sink.init();

  await assert.rejects(() => sink.write(buildComplexBlock(555)), /insert failed/);

  failureState.failOnCall = undefined;
  await sink.flush();

  assert.deepEqual(
    client.insertCalls.map((call) => call.table),
    [
      'core.blocks',
      'core.transactions',
      'core.blocks',
      'core.transactions',
      'core.messages',
      'core.events',
      'core.event_attrs',
      'bank.transfers',
      'stake.delegation_events',
      'stake.distribution_events',
      'wasm.executions',
      'wasm.events',
      'gov.deposits',
      'gov.votes',
      'gov.proposals',
    ],
  );

  await sink.close();
});

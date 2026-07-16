import { extendZodWithOpenApi, OpenApiGeneratorV31, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

registry.registerComponent('securitySchemes', 'apiKey', {
  type: 'apiKey',
  in: 'header',
  name: 'x-api-key',
});

const BlockSummary = registry.register(
  'BlockSummary',
  z.object({
    block_hash: z.string(),
    height: z.string().describe('Block height (uint64 as decimal string)'),
    time: z.string().datetime(),
    tx_count: z.number().int(),
    proposer_address: z.string(),
  }),
);

const BlockDetail = registry.register(
  'BlockDetail',
  BlockSummary.extend({
    size_bytes: z.number().int().nullable(),
    last_commit_hash: z.string().nullable(),
    data_hash: z.string().nullable(),
    app_hash: z.string().nullable(),
    evidence_count: z.number().int(),
  }),
);

const BlockCursor = registry.register('BlockCursor', z.object({ next_before_height: z.string() }).nullable());

const TxSummary = registry.register(
  'TxSummary',
  z.object({
    tx_hash: z.string(),
    height: z.string().describe('Block height (uint64 as decimal string)'),
    tx_index: z.number().int(),
    time: z.string().datetime(),
    code: z.number().int(),
    first_msg_type: z.string().nullable(),
    fee: z.object({ amount: z.string().nullable(), denom: z.string().nullable() }).nullable(),
  }),
);

const TxByAddressSummary = registry.register(
  'TxByAddressSummary',
  TxSummary.extend({
    transfers: z.array(
      z.object({
        from_addr: z.string(),
        to_addr: z.string(),
        denom: z.string(),
        amount: z.string().describe('Transfer amount in base units'),
      }),
    ),
  }),
);

const TxDetail = registry.register(
  'TxDetail',
  z.object({
    tx_hash: z.string(),
    height: z.string().describe('Block height (uint64 as decimal string)'),
    tx_index: z.number().int(),
    time: z.string().datetime(),
    code: z.number().int(),
    gas_wanted: z.string().nullable(),
    gas_used: z.string().nullable(),
    fee: z
      .object({
        amount: z.array(z.object({ amount: z.string(), denom: z.string() })),
        gas_limit: z.string(),
        payer: z.string(),
        granter: z.string(),
      })
      .nullable(),
    memo: z.string().nullable(),
    signers: z.array(z.string()).nullable(),
    log_summary: z.string().nullable(),
    messages: z.array(
      z.object({
        msg_index: z.number().int(),
        type_url: z.string(),
        value: z.record(z.unknown()),
        signer: z.string().nullable(),
      }),
    ),
    events: z.array(
      z.object({
        msg_index: z.number().int(),
        event_index: z.number().int(),
        event_type: z.string(),
        attributes: z.unknown(),
      }),
    ),
  }),
);

const TxCursor = registry.register(
  'TxCursor',
  z.object({ next_before_height: z.string(), next_before_index: z.number().int() }).nullable(),
);

const DelegationEvent = registry.register(
  'DelegationEvent',
  z.object({
    delegator_address: z.string().describe('Delegator account address (e.g. atone1...)'),
    amount: z.string().describe('Raw base-denom amount (numeric(80,0) as decimal string)'),
    denom: z.string().describe('Base denom, e.g. uatone'),
    height: z.string().describe('Block height (uint64 as decimal string)'),
    tx_index: z.number().int(),
    msg_index: z.number().int(),
    tx_hash: z.string(),
    time: z.string().datetime(),
  }),
);

const DelegationsCursor = registry.register(
  'DelegationsCursor',
  z
    .object({
      next_before_height: z.string(),
      next_before_index: z.number().int(),
      next_before_msg_index: z.number().int(),
    })
    .nullable(),
);

const Coverage = registry.register(
  'Coverage',
  z.object({
    earliest_height: z.string().describe('Earliest block height available in this indexer'),
    earliest_time: z.string().datetime().describe('Timestamp of the earliest indexed block'),
  }),
);

const EarliestActivity = registry.register(
  'EarliestActivity',
  z.object({
    height: z.string().describe('Earliest indexed transaction height'),
    tx_index: z.number().int().describe('Transaction index within the block'),
    tx_hash: z.string(),
    time: z.string().datetime(),
    source: z.enum(['actor', 'transfer_out', 'transfer_in']),
  }),
);

const StakingDelta = registry.register(
  'StakingDelta',
  z.object({
    height: z.string(),
    tx_index: z.number().int(),
    msg_index: z.number().int(),
    tx_hash: z.string(),
    time: z.string().datetime(),
    event_type: z.enum(['delegate', 'redelegate', 'unbond', 'create_validator', 'cancel_unbonding_delegation']),
    validator_src: z.string().nullable(),
    validator_dst: z.string().nullable(),
    denom: z.string(),
    amount: z.string().describe('Unsigned amount in base units'),
    sign: z.union([z.literal(1), z.literal(-1), z.literal(0)]),
    source: z.enum(['event', 'message']),
  }),
);

const StakingDeltasCursor = registry.register(
  'StakingDeltasCursor',
  z
    .object({
      next_before_height: z.string(),
      next_before_index: z.number().int(),
      next_before_msg_index: z.number().int(),
    })
    .nullable(),
);

const ErrorResponse = registry.register(
  'ErrorResponse',
  z.object({
    error: z.enum(['invalid_params', 'unauthorized', 'not_found', 'internal_error']),
    details: z.unknown().optional(),
  }),
);

const IbcTransfer = registry.register(
  'IbcTransfer',
  z.object({
    port_id_src: z.string(),
    channel_id_src: z.string(),
    sequence: z.string().describe('IBC packet sequence (uint64 as decimal string)'),
    port_id_dst: z.string().nullable(),
    channel_id_dst: z.string().nullable(),
    status: z.enum(['sent', 'received', 'acknowledged', 'timeout', 'failed']),
    direction: z.enum(['outgoing', 'incoming']),
    event_height: z.string().nullable().describe('COALESCE(height_send, height_recv) as decimal string'),
    event_time: z.string().datetime().nullable(),
    tx_hash_send: z.string().nullable(),
    height_send: z.string().nullable(),
    tx_hash_recv: z.string().nullable(),
    height_recv: z.string().nullable(),
    tx_hash_ack: z.string().nullable(),
    height_ack: z.string().nullable(),
    denom: z.string().nullable(),
    amount: z.string().nullable().describe('Token amount (numeric(80,0) as decimal string)'),
    memo: z.string().nullable(),
    relayer: z.string().nullable(),
    timeout_height: z.string().nullable(),
    timeout_ts: z.string().nullable().describe('Unix nanoseconds (uint64 as decimal string)'),
  }),
);

const IbcTransfersCursor = registry.register(
  'IbcTransfersCursor',
  z
    .object({
      next_before_height: z.string(),
      next_before_sequence: z.string(),
      next_before_channel: z.string(),
      next_before_port: z.string(),
    })
    .nullable(),
);

registry.registerPath({
  method: 'get',
  path: '/api/v1/health',
  summary: 'Health check',
  tags: ['operational'],
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: z.object({ status: z.string() }) } } },
    503: { description: 'Degraded', content: { 'application/json': { schema: z.object({ status: z.string() }) } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/blocks',
  summary: 'List blocks (latest first)',
  tags: ['blocks'],
  request: {
    headers: z.object({ 'x-api-key': z.string() }),
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
      before_height: z.string().max(20).optional(),
    }),
  },
  responses: {
    200: {
      description: 'Paginated block list',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(BlockSummary),
            cursor: BlockCursor,
            has_more: z.boolean(),
            total: z.string(),
          }),
        },
      },
    },
    400: { description: 'Invalid params', content: { 'application/json': { schema: ErrorResponse } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponse } } },
  },
  security: [{ apiKey: [] }],
});

const BlocksStats = registry.register(
  'BlocksStats',
  z.object({
    total_blocks: z.string().describe('Latest indexed block height (uint64 as decimal string)'),
    last_height: z.string().describe('Latest indexed block height (uint64 as decimal string)'),
  }),
);

const TxsStats = registry.register(
  'TxsStats',
  z.object({
    total_txs: z.string().describe('Total transaction count (uint64 as decimal string)'),
    last_height: z.string().describe('Max block height containing a transaction (uint64 as decimal string)'),
  }),
);

registry.registerPath({
  method: 'get',
  path: '/api/v1/blocks/stats',
  summary: 'Block stats (chain head + total)',
  tags: ['blocks'],
  request: { headers: z.object({ 'x-api-key': z.string() }) },
  responses: {
    200: {
      description: 'Block stats',
      content: { 'application/json': { schema: z.object({ data: BlocksStats }) } },
    },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponse } } },
  },
  security: [{ apiKey: [] }],
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/txs/stats',
  summary: 'Transaction stats (count + last height, cached 60s)',
  tags: ['transactions'],
  request: { headers: z.object({ 'x-api-key': z.string() }) },
  responses: {
    200: {
      description: 'Transaction stats',
      content: { 'application/json': { schema: z.object({ data: TxsStats }) } },
    },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponse } } },
  },
  security: [{ apiKey: [] }],
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/blocks/height/{h}',
  summary: 'Get block by height',
  tags: ['blocks'],
  request: {
    headers: z.object({ 'x-api-key': z.string() }),
    params: z.object({ h: z.string() }),
  },
  responses: {
    200: {
      description: 'Block detail',
      content: { 'application/json': { schema: z.object({ data: BlockDetail }) } },
    },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponse } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponse } } },
  },
  security: [{ apiKey: [] }],
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/txs',
  summary: 'List transactions (latest first)',
  tags: ['transactions'],
  request: {
    headers: z.object({ 'x-api-key': z.string() }),
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
      before_height: z.string().max(20).optional(),
      before_index: z.coerce.number().int().optional(),
    }),
  },
  responses: {
    200: {
      description: 'Paginated transaction list',
      content: {
        'application/json': {
          schema: z.object({ data: z.array(TxSummary), cursor: TxCursor, has_more: z.boolean(), total: z.string() }),
        },
      },
    },
    400: { description: 'Invalid params', content: { 'application/json': { schema: ErrorResponse } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponse } } },
  },
  security: [{ apiKey: [] }],
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/txs/{hash}',
  summary: 'Get transaction detail',
  tags: ['transactions'],
  request: {
    headers: z.object({ 'x-api-key': z.string() }),
    params: z.object({ hash: z.string() }),
  },
  responses: {
    200: {
      description: 'Transaction detail with messages and events',
      content: { 'application/json': { schema: z.object({ data: TxDetail }) } },
    },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponse } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponse } } },
  },
  security: [{ apiKey: [] }],
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/txs/{hash}/raw',
  summary: 'Get raw transaction JSON',
  tags: ['transactions'],
  request: {
    headers: z.object({ 'x-api-key': z.string() }),
    params: z.object({ hash: z.string() }),
  },
  responses: {
    200: {
      description: 'Raw transaction payload',
      content: {
        'application/json': {
          schema: z.object({ data: z.object({ raw_tx: z.unknown() }) }),
        },
      },
    },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponse } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponse } } },
  },
  security: [{ apiKey: [] }],
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/ibc/transfers',
  summary: 'List IBC transfers (newest first, keyset cursor)',
  tags: ['ibc'],
  request: {
    headers: z.object({ 'x-api-key': z.string() }),
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
      before_height: z.string().max(20).optional(),
      before_sequence: z.string().max(20).optional(),
      before_channel: z.string().max(64).optional(),
      before_port: z.string().max(128).optional(),
    }),
  },
  responses: {
    200: {
      description: 'Paginated IBC transfers list',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(IbcTransfer),
            cursor: IbcTransfersCursor,
            has_more: z.boolean(),
            total: z.string(),
          }),
        },
      },
    },
    400: { description: 'Invalid params', content: { 'application/json': { schema: ErrorResponse } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponse } } },
  },
  security: [{ apiKey: [] }],
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/ibc/transfers/{port}/{channel}/{sequence}',
  summary: 'Get IBC transfer by canonical packet key',
  tags: ['ibc'],
  request: {
    headers: z.object({ 'x-api-key': z.string() }),
    params: z.object({
      port: z.string(),
      channel: z.string(),
      sequence: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'IBC transfer detail',
      content: { 'application/json': { schema: z.object({ data: IbcTransfer }) } },
    },
    400: { description: 'Invalid params', content: { 'application/json': { schema: ErrorResponse } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponse } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponse } } },
  },
  security: [{ apiKey: [] }],
});

const GovVote = registry.register(
  'GovVote',
  z.object({
    proposal_id: z.string().describe('Governance proposal id (uint64 as decimal string)'),
    option: z.enum(['YES', 'NO', 'ABSTAIN', 'VETO', 'UNSPECIFIED']),
    weight: z.string().nullable().describe('Weighted-vote weight for the option, or null for simple votes'),
    height: z.string().describe('Block height of the final vote (uint64 as decimal string)'),
    tx_hash: z.string(),
  }),
);

const GovVotesCursor = registry.register(
  'GovVotesCursor',
  z.object({ next_before_proposal_id: z.string() }).nullable(),
);

registry.registerPath({
  method: 'get',
  path: '/api/v1/gov/votes',
  summary: "List an account's final governance votes (newest proposal first, keyset cursor)",
  tags: ['gov'],
  request: {
    headers: z.object({ 'x-api-key': z.string() }),
    query: z.object({
      voter: z.string().describe('Voter account bech32 address (e.g. atone1...)'),
      limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
      before_proposal_id: z.string().max(20).optional(),
    }),
  },
  responses: {
    200: {
      description: "Paginated list of the account's final vote per proposal",
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(GovVote),
            cursor: GovVotesCursor,
            has_more: z.boolean(),
            total: z.string(),
          }),
        },
      },
    },
    400: { description: 'Invalid params', content: { 'application/json': { schema: ErrorResponse } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponse } } },
  },
  security: [{ apiKey: [] }],
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/txs/by-address',
  summary: 'List transactions involving an address (newest first, keyset cursor)',
  tags: ['transactions'],
  request: {
    headers: z.object({ 'x-api-key': z.string() }),
    query: z.object({
      address: z
        .string()
        .describe(
          'Comma-separated list of 1-5 bech32 addresses (e.g. atone1... or atone1...,atonevaloper1... for a validator). Returns txs ANY of the addresses is involved in (signer/sender/delegator/validator/granter/grantee).',
        ),
      limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
      before_height: z.string().max(20).optional(),
      before_index: z.coerce.number().int().optional(),
      msg_type: z.string().optional().describe('Comma-separated list of 1-5 exact Cosmos SDK message type URLs'),
      from_time: z.string().datetime({ offset: true }).optional().describe('Inclusive lower ISO-8601 timestamp'),
      to_time: z.string().datetime({ offset: true }).optional().describe('Inclusive upper ISO-8601 timestamp'),
      min_amount: z
        .string()
        .max(80)
        .regex(/^\d+$/)
        .optional()
        .describe('Inclusive minimum transfer amount in base units; requires amount_denom'),
      max_amount: z
        .string()
        .max(80)
        .regex(/^\d+$/)
        .optional()
        .describe('Inclusive maximum transfer amount in base units; requires amount_denom'),
      amount_denom: z
        .string()
        .min(2)
        .max(128)
        .optional()
        .describe('Transfer denomination; requires min_amount or max_amount'),
      count: z
        .enum(['true', 'false'])
        .default('true')
        .optional()
        .describe(
          "Set 'false' to skip the exact COUNT(*) `total` (returns total='0'). Cursor clients that don't use `total` should disable it — the COUNT over a large match set (e.g. a top validator) can cost 10–20s.",
        ),
    }),
  },
  responses: {
    200: {
      description: 'Paginated list of transactions involving the address',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(TxByAddressSummary),
            cursor: TxCursor,
            has_more: z.boolean(),
            total: z.string(),
          }),
        },
      },
    },
    400: { description: 'Invalid params', content: { 'application/json': { schema: ErrorResponse } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponse } } },
  },
  security: [{ apiKey: [] }],
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/coverage',
  summary: 'Get the earliest block covered by this indexer',
  tags: ['operational'],
  request: { headers: z.object({ 'x-api-key': z.string() }) },
  responses: {
    200: {
      description: 'Indexer coverage boundary',
      content: { 'application/json': { schema: z.object({ data: Coverage }) } },
    },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponse } } },
    404: { description: 'No indexed blocks', content: { 'application/json': { schema: ErrorResponse } } },
  },
  security: [{ apiKey: [] }],
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/address/earliest-activity',
  summary: "Get an account's earliest indexed actor or transfer activity",
  tags: ['address'],
  request: {
    headers: z.object({ 'x-api-key': z.string() }),
    query: z.object({ address: z.string().describe('Account bech32 address') }),
  },
  responses: {
    200: {
      description: 'Earliest indexed activity plus the indexer coverage boundary',
      content: {
        'application/json': {
          schema: z.object({ data: z.object({ earliest: EarliestActivity.nullable(), coverage: Coverage }) }),
        },
      },
    },
    400: { description: 'Invalid params', content: { 'application/json': { schema: ErrorResponse } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponse } } },
    404: { description: 'No indexed blocks', content: { 'application/json': { schema: ErrorResponse } } },
  },
  security: [{ apiKey: [] }],
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/staking/deltas',
  summary: "List an account's signed staking deltas",
  description:
    'Returns raw delegated-stake facts, not bonded governance voting power. Bonded-status transitions, slashing, and validator exchange-rate drift are not reconstructed. Ambiguous multi-inner MsgExec physical keys are excluded and counted in meta.',
  tags: ['staking'],
  request: {
    headers: z.object({ 'x-api-key': z.string() }),
    query: z.object({
      delegator: z.string().describe('Delegator account bech32 address'),
      limit: z.coerce.number().int().min(1).max(100).default(100).optional(),
      before_height: z.string().max(20).optional(),
      before_index: z.coerce.number().int().min(0).optional(),
      before_msg_index: z.coerce.number().int().min(-1).optional(),
    }),
  },
  responses: {
    200: {
      description: 'Paginated signed staking facts ordered by height, transaction, and message',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(StakingDelta),
            cursor: StakingDeltasCursor,
            has_more: z.boolean(),
            total: z.string(),
            meta: z.object({ skipped_ambiguous_msgexec: z.string() }),
          }),
        },
      },
    },
    400: { description: 'Invalid params', content: { 'application/json': { schema: ErrorResponse } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponse } } },
  },
  security: [{ apiKey: [] }],
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/staking/delegations',
  summary: 'List delegation events for a validator (newest first, keyset cursor)',
  tags: ['staking'],
  request: {
    headers: z.object({ 'x-api-key': z.string() }),
    query: z.object({
      validator: z.string().describe('Validator operator bech32 address (e.g. atonevaloper1...)'),
      limit: z.coerce.number().int().min(1).max(100).default(20).optional(),
      before_height: z.string().max(20).optional(),
      before_index: z.coerce.number().int().min(0).optional(),
      before_msg_index: z.coerce.number().int().min(-1).optional(),
    }),
  },
  responses: {
    200: {
      description: 'Paginated list of delegation events for the validator',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(DelegationEvent),
            cursor: DelegationsCursor,
            has_more: z.boolean(),
            total: z.string().describe("Always '0'; this cursor endpoint does not run COUNT(*)"),
          }),
        },
      },
    },
    400: { description: 'Invalid params', content: { 'application/json': { schema: ErrorResponse } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponse } } },
  },
  security: [{ apiKey: [] }],
});

export function generateOpenApiDocument() {
  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'AtomOne Indexer API',
      version: '1.0.0',
      description: 'Read-only JSON API over the AtomOne chain data indexed by chain-data-indexer.',
    },
    servers: [{ url: '/api/v1', description: 'API v1' }],
  });
}

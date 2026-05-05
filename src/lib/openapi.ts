import { OpenApiGeneratorV31, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

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

const BlockCursor = registry.register(
  'BlockCursor',
  z.object({ next_before_height: z.string() }).nullable(),
);

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

const ErrorResponse = registry.register(
  'ErrorResponse',
  z.object({
    error: z.enum(['invalid_params', 'unauthorized', 'not_found', 'internal_error']),
    details: z.unknown().optional(),
  }),
);

const ListMeta = registry.register(
  'ListMeta',
  z.object({ has_more: z.boolean(), total: z.string() }),
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
          schema: z.object({ data: z.array(BlockSummary), cursor: BlockCursor, has_more: z.boolean(), total: z.string() }),
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

// suppress unused-variable warning — used for OpenAPI output shape documentation
void ListMeta;

export function generateOpenApiDocument() {
  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Cosmos Indexer API',
      version: '1.0.0',
      description: 'Read-only JSON API over the Cosmos chain data indexed by chain-data-indexer.',
    },
    servers: [{ url: '/api/v1', description: 'API v1' }],
  });
}

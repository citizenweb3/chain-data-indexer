import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from '@asteasolutions/zod-to-openapi';

import { z } from '@/lib/openapi-zod';

import { AssetsBreakdownQuerySchema, AssetsBreakdownResponseSchema } from '@/schemas/assets';
import { ChannelsQuerySchema, ChannelsResponseSchema } from '@/schemas/channels';
import { ChainParam, ErrorResponseSchema } from '@/schemas/common';
import {
  StatsCombinedQuerySchema,
  StatsQuerySchema,
  StatsResponseSchema,
} from '@/schemas/stats';
import { TimeseriesQuerySchema, TimeseriesResponseSchema } from '@/schemas/timeseries';
import {
  TransferDetailResponseSchema,
  TransferParamSchema,
  TransfersListQuerySchema,
  TransfersListResponseSchema,
} from '@/schemas/transfers';

const ChainSyncWatermarkSchema = z
  .object({
    chain: ChainParam,
    last_synced_at: z.string().nullable(),
    last_synced_height: z.string().nullable(),
  })
  .openapi('ChainSyncWatermark');

const HealthResponseSchema = z
  .object({
    ok: z.boolean(),
    db_ready: z.boolean(),
    chains: z.array(ChainSyncWatermarkSchema),
  })
  .openapi('HealthResponse');

const registry = new OpenAPIRegistry();

registry.register('ErrorResponse', ErrorResponseSchema);
registry.register('StatsResponse', StatsResponseSchema);
registry.register('ChannelsResponse', ChannelsResponseSchema);
registry.register('TimeseriesResponse', TimeseriesResponseSchema);
registry.register('TransfersListResponse', TransfersListResponseSchema);
registry.register('TransferDetailResponse', TransferDetailResponseSchema);
registry.register('AssetsBreakdownResponse', AssetsBreakdownResponseSchema);

const errorRef = { $ref: '#/components/schemas/ErrorResponse' };

const error400 = {
  description: 'Invalid query/path parameters',
  content: { 'application/json': { schema: errorRef } },
} as const;

const error404 = {
  description: 'Not found (unknown chain or missing resource)',
  content: { 'application/json': { schema: errorRef } },
} as const;

const error500 = {
  description: 'Internal server error',
  content: { 'application/json': { schema: errorRef } },
} as const;

const ChainPathParamsSchema = z
  .object({ chain: ChainParam })
  .openapi('ChainPathParams');

const TransferChainParamSchema = TransferParamSchema.extend({
  chain: ChainParam,
}).openapi('TransferChainParam');

const TAG_COMBINED = 'Combined';
const TAG_PER_CHAIN = 'Per-chain';
const TAG_SYSTEM = 'System';

registry.registerPath({
  method: 'get',
  path: '/api/v1/health',
  summary: 'Service health and per-chain sync watermarks',
  tags: [TAG_SYSTEM],
  responses: {
    200: {
      description: 'Service is reachable',
      content: { 'application/json': { schema: HealthResponseSchema } },
    },
    500: error500,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/stats',
  summary: 'Combined transfer counts and ATOM/USD volume across all chains. Optional ?breakdown=chain adds per-chain split.',
  tags: [TAG_COMBINED],
  request: { query: StatsCombinedQuerySchema },
  responses: {
    200: {
      description: 'Stats payload (optionally with per_chain array)',
      content: { 'application/json': { schema: StatsResponseSchema } },
    },
    400: error400,
    500: error500,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/channels',
  summary: 'List IBC channels across all chains. Each row carries its chain field.',
  tags: [TAG_COMBINED],
  request: { query: ChannelsQuerySchema },
  responses: {
    200: {
      description: 'Channels listing with pagination envelope',
      content: { 'application/json': { schema: ChannelsResponseSchema } },
    },
    400: error400,
    500: error500,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/assets',
  summary: 'Per-asset breakdown of transfers and volume, aggregated across all chains.',
  tags: [TAG_COMBINED],
  request: { query: AssetsBreakdownQuerySchema },
  responses: {
    200: {
      description: 'Per-asset breakdown sorted by USD volume desc',
      content: { 'application/json': { schema: AssetsBreakdownResponseSchema } },
    },
    400: error400,
    500: error500,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/timeseries',
  summary: 'Metric series across all chains — daily (default) or hourly (bucket=hour) for transfers / volume_atom / volume_usd',
  tags: [TAG_COMBINED],
  request: { query: TimeseriesQuerySchema },
  responses: {
    200: {
      description: 'Time series payload (zero-filled across requested range)',
      content: { 'application/json': { schema: TimeseriesResponseSchema } },
    },
    400: error400,
    500: error500,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/{chain}/stats',
  summary: 'Aggregated transfer counts and ATOM/USD volume for a single chain.',
  tags: [TAG_PER_CHAIN],
  request: { params: ChainPathParamsSchema, query: StatsQuerySchema },
  responses: {
    200: {
      description: 'Stats payload for the given chain',
      content: { 'application/json': { schema: StatsResponseSchema } },
    },
    400: error400,
    404: error404,
    500: error500,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/{chain}/channels',
  summary: 'List IBC channels for a single chain.',
  tags: [TAG_PER_CHAIN],
  request: { params: ChainPathParamsSchema, query: ChannelsQuerySchema },
  responses: {
    200: {
      description: 'Channels listing with pagination envelope',
      content: { 'application/json': { schema: ChannelsResponseSchema } },
    },
    400: error400,
    404: error404,
    500: error500,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/{chain}/assets',
  summary: 'Per-asset breakdown of transfers and volume for a single chain.',
  tags: [TAG_PER_CHAIN],
  request: { params: ChainPathParamsSchema, query: AssetsBreakdownQuerySchema },
  responses: {
    200: {
      description: 'Per-asset breakdown sorted by USD volume desc',
      content: { 'application/json': { schema: AssetsBreakdownResponseSchema } },
    },
    400: error400,
    404: error404,
    500: error500,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/{chain}/timeseries',
  summary: 'Metric series for a single chain — daily (default) or hourly (bucket=hour) for transfers / volume_atom / volume_usd',
  tags: [TAG_PER_CHAIN],
  request: { params: ChainPathParamsSchema, query: TimeseriesQuerySchema },
  responses: {
    200: {
      description: 'Time series payload (zero-filled across requested range)',
      content: { 'application/json': { schema: TimeseriesResponseSchema } },
    },
    400: error400,
    404: error404,
    500: error500,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/{chain}/transfers',
  summary: 'List IBC transfers for a single chain with keyset pagination.',
  tags: [TAG_PER_CHAIN],
  request: { params: ChainPathParamsSchema, query: TransfersListQuerySchema },
  responses: {
    200: {
      description: 'Transfers list',
      content: { 'application/json': { schema: TransfersListResponseSchema } },
    },
    400: error400,
    404: error404,
    500: error500,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/{chain}/transfers/{port}/{channel}/{sequence}',
  summary: 'Transfer detail by primary key on a single chain.',
  tags: [TAG_PER_CHAIN],
  request: { params: TransferChainParamSchema },
  responses: {
    200: {
      description: 'Transfer DTO',
      content: { 'application/json': { schema: TransferDetailResponseSchema } },
    },
    400: error400,
    404: error404,
    500: error500,
  },
});

export const generateOpenApiDocument = () => {
  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Crosschain IBC Indexer API',
      version: '0.2.0',
      description:
        'Read-only API serving IBC packet data indexed from upstream Cosmos chains. ' +
        'All BigInt and Decimal values are returned as strings to preserve precision. ' +
        'Endpoints under /api/v1/{chain}/* are per-chain; the flat /api/v1/* paths are combined across all chains.',
    },
    servers: [{ url: '/' }],
    tags: [
      { name: TAG_SYSTEM, description: 'Health checks and worker sync state' },
      { name: TAG_COMBINED, description: 'Combined endpoints across all chains' },
      { name: TAG_PER_CHAIN, description: 'Per-chain endpoints scoped to a single chain' },
    ],
  });
};

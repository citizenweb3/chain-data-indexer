import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from '@asteasolutions/zod-to-openapi';

import { z } from '@/lib/openapi-zod';

import { AssetsBreakdownQuerySchema, AssetsBreakdownResponseSchema } from '@/schemas/assets';
import { ChannelsQuerySchema, ChannelsResponseSchema } from '@/schemas/channels';
import { ErrorResponseSchema } from '@/schemas/common';
import { StatsQuerySchema, StatsResponseSchema } from '@/schemas/stats';
import { TimeseriesQuerySchema, TimeseriesResponseSchema } from '@/schemas/timeseries';
import {
  TransferDetailResponseSchema,
  TransferParamSchema,
  TransfersListQuerySchema,
  TransfersListResponseSchema,
} from '@/schemas/transfers';

const HealthResponseSchema = z
  .object({
    ok: z.boolean(),
    db_ready: z.boolean(),
    last_synced_at: z.string().nullable(),
    last_synced_height: z.string().nullable(),
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

const error500 = {
  description: 'Internal server error',
  content: { 'application/json': { schema: errorRef } },
} as const;

registry.registerPath({
  method: 'get',
  path: '/api/v1/health',
  summary: 'Service health and last sync watermark',
  tags: ['system'],
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
  summary: 'Aggregated transfer counts and ATOM/USD volume for 24h/7d/30d windows',
  tags: ['stats'],
  request: { query: StatsQuerySchema },
  responses: {
    200: {
      description: 'Stats payload',
      content: { 'application/json': { schema: StatsResponseSchema } },
    },
    400: error400,
    500: error500,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/channels',
  summary: 'List IBC channels with bucketed transfer/volume metrics',
  tags: ['channels'],
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
  summary: 'Per-asset breakdown of transfers and volume for 24h/7d/30d windows',
  tags: ['assets'],
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
  summary: 'Metric series — daily (default) or hourly (bucket=hour, fixed 24h window) for transfers / volume_atom / volume_usd',
  tags: ['timeseries'],
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
  path: '/api/v1/transfers',
  summary: 'List IBC transfers with keyset pagination',
  tags: ['transfers'],
  request: { query: TransfersListQuerySchema },
  responses: {
    200: {
      description: 'Transfers list',
      content: { 'application/json': { schema: TransfersListResponseSchema } },
    },
    400: error400,
    500: error500,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/transfers/{port}/{channel}/{sequence}',
  summary: 'Transfer detail by primary key',
  tags: ['transfers'],
  request: { params: TransferParamSchema },
  responses: {
    200: {
      description: 'Transfer DTO',
      content: { 'application/json': { schema: TransferDetailResponseSchema } },
    },
    400: error400,
    404: {
      description: 'Transfer not found',
      content: { 'application/json': { schema: errorRef } },
    },
    500: error500,
  },
});

export const generateOpenApiDocument = () => {
  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Crosschain IBC Indexer API',
      version: '0.1.0',
      description:
        'Read-only API serving IBC packet data indexed from upstream Cosmos chains. ' +
        'All BigInt and Decimal values are returned as strings to preserve precision.',
    },
    servers: [{ url: '/' }],
  });
};

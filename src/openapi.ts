export function getOpenApiDocument(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Monero Indexer API',
      version: '0.18.4.6',
      description: 'Read-only Monero explorer API for blocks, transactions, supply, health, and metrics.',
    },
    paths: {
      '/health': {
        get: {
          summary: 'Health and lag status',
          responses: { '200': { description: 'Healthy' }, '503': { description: 'Degraded' } },
        },
      },
      '/metrics': {
        get: {
          summary: 'Prometheus metrics',
          responses: { '200': { description: 'Prometheus text format' } },
        },
      },
      '/api/v1/stats': {
        get: {
          summary: 'Network and indexer summary',
          responses: { '200': { description: 'Stats response' } },
        },
      },
      '/api/v1/blocks': {
        get: {
          summary: 'Paginated block list',
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
            { name: 'canonical', in: 'query', schema: { type: 'string', enum: ['true', 'false', 'all'], default: 'true' } },
            { name: 'settled', in: 'query', schema: { type: 'string', enum: ['true', 'false', 'all'], default: 'all' } },
            { name: 'order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' } },
          ],
          responses: { '200': { description: 'Block list response' } },
        },
      },
      '/api/v1/blocks/{id}': {
        get: {
          summary: 'Block detail by hash or canonical height',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Block detail response' }, '404': { description: 'Not found' } },
        },
      },
      '/api/v1/transactions': {
        get: {
          summary: 'Paginated transaction list',
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
            { name: 'canonical', in: 'query', schema: { type: 'string', enum: ['true', 'false', 'all'], default: 'true' } },
            { name: 'settled', in: 'query', schema: { type: 'string', enum: ['true', 'false', 'all'], default: 'all' } },
            { name: 'order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' } },
            { name: 'block_hash', in: 'query', schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Transaction list response' } },
        },
      },
      '/api/v1/transactions/{id}': {
        get: {
          summary: 'Transaction detail by hash',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Transaction detail response' }, '404': { description: 'Not found' } },
        },
      },
      '/api/v1/supply': {
        get: {
          summary: 'Paginated supply checkpoint series',
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
            { name: 'order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' } },
          ],
          responses: { '200': { description: 'Supply series response' } },
        },
      },
    },
  };
}

export function swaggerHtml(): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Monero Indexer API Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      body { margin: 0; background: #fafafa; }
      #swagger-ui { max-width: 1200px; margin: 0 auto; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: '/openapi.json',
        dom_id: '#swagger-ui',
      });
    </script>
  </body>
</html>`;
}

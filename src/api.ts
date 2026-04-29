import http from 'node:http';
import { config } from './config.js';
import { logger } from './utils/logger.js';

const startedAt = Date.now();

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function sendNotImplemented(res: http.ServerResponse, endpoint: string): void {
  sendJson(res, 501, {
    error: 'not_implemented',
    endpoint,
    message: 'Miden indexer API scaffold; implementation pending.',
  });
}

function sendNotFound(res: http.ServerResponse): void {
  sendJson(res, 404, { error: 'not_found' });
}

function sendMethodNotAllowed(res: http.ServerResponse): void {
  sendJson(res, 405, { error: 'method_not_allowed' });
}

async function route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method !== 'GET') {
    sendMethodNotAllowed(res);
    return;
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

  if (url.pathname === '/health') {
    sendJson(res, 200, {
      ok: true,
      lag: null,
      uptime_s: Math.floor((Date.now() - startedAt) / 1_000),
    });
    return;
  }

  if (parts[0] !== 'api' || parts[1] !== 'v1') {
    sendNotFound(res);
    return;
  }

  const resource = parts[2];
  const isStubbed =
    (parts.length === 3 && ['stats', 'blocks', 'notes', 'nullifiers'].includes(resource ?? '')) ||
    (parts.length === 4 && resource === 'blocks' && /^\d+$/.test(parts[3])) ||
    (parts.length === 4 && resource === 'accounts');

  if (isStubbed) {
    sendNotImplemented(res, url.pathname);
    return;
  }

  sendNotFound(res);
}

export function startApiServer(): () => void {
  const server = http.createServer((req, res) => {
    route(req, res).catch((err: unknown) => {
      logger.error('API request failed', { err });
      sendJson(res, 500, { error: 'internal_server_error' });
    });
  });

  server.listen(config.INDEXER_HTTP_PORT, () => {
    logger.info('Miden indexer API server listening', { port: config.INDEXER_HTTP_PORT });
  });

  return () => {
    server.close();
  };
}

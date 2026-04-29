/**
 * @module health/server
 * Lightweight HTTP server exposing /health (and /healthz alias) for container
 * orchestration probes and external uptime checks.
 *
 * Health logic:
 *   - db check: SELECT last_height, updated_at FROM core.indexer_progress
 *   - progress freshness: now() - updated_at <= staleSeconds
 *   - rpc reachability: in-memory flag set by waitForRpcStatus()
 *
 * During the startup grace period (default 300s) the progress check is
 * considered ok even without a row, so cold starts and long backfill resumes
 * are not flagged as unhealthy.
 *
 * Returns HTTP 200 (healthy) or 503 (degraded) with a JSON body describing
 * each individual check — useful for both Docker healthchecks and human
 * debugging.
 */
import { createServer, type Server } from 'node:http';
import type { Pool } from 'pg';
import { getLogger } from '../utils/logger.ts';
import { healthState } from './state.ts';

const log = getLogger('health');

export interface HealthServerOptions {
  port: number;
  staleSeconds: number;
  startupGraceSeconds?: number;
  progressId: string;
  getDbPool: () => Pool | null;
}

interface CheckResult {
  ok: boolean;
  detail?: unknown;
}

interface HealthResponse {
  healthy: boolean;
  status: 'ok' | 'degraded';
  uptime_seconds: number;
  phase: string;
  bulk_mode: boolean;
  checks: Record<string, CheckResult>;
}

export function startHealthServer(opts: HealthServerOptions): Server {
  const startupGraceSeconds = opts.startupGraceSeconds ?? 300;

  const server = createServer((req, res) => {
    void handleRequest(req, res, opts, startupGraceSeconds);
  });

  server.on('error', (err) => log.error(`server error: ${err}`));
  server.listen(opts.port, () => log.info(`listening on :${opts.port}`));

  return server;
}

export function stopHealthServer(server: Server | null): Promise<void> {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

async function handleRequest(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  opts: HealthServerOptions,
  startupGraceSeconds: number,
): Promise<void> {
  const url = req.url ?? '/';
  const path = url.split('?')[0];
  if (path !== '/health' && path !== '/healthz' && path !== '/') {
    res.statusCode = 404;
    res.end('not found\n');
    return;
  }

  const result = await checkHealth(opts, startupGraceSeconds);
  res.statusCode = result.healthy ? 200 : 503;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(result, null, 2) + '\n');
}

async function checkHealth(
  opts: HealthServerOptions,
  startupGraceSeconds: number,
): Promise<HealthResponse> {
  const now = Date.now();
  const uptimeSec = Math.floor((now - healthState.startedAt) / 1000);
  const inStartupGrace = uptimeSec < startupGraceSeconds;
  const checks: Record<string, CheckResult> = {};

  // ── DB check: query progress row directly (single source of truth)
  let dbHeight: number | null = null;
  let dbUpdatedAtMs: number | null = null;
  try {
    const pool = opts.getDbPool();
    if (!pool) {
      checks.db = { ok: inStartupGrace, detail: 'pool not initialized yet' };
    } else {
      const r = await pool.query<{ last_height: string; updated_at: Date }>(
        'SELECT last_height, updated_at FROM core.indexer_progress WHERE id = $1',
        [opts.progressId],
      );
      if (r.rowCount && r.rows[0]) {
        dbHeight = Number(r.rows[0].last_height);
        dbUpdatedAtMs = new Date(r.rows[0].updated_at).getTime();
      }
      checks.db = {
        ok: true,
        detail:
          dbHeight != null
            ? { last_height: dbHeight, updated_at: new Date(dbUpdatedAtMs!).toISOString() }
            : 'no progress row yet',
      };
    }
  } catch (e) {
    checks.db = { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }

  // ── Progress freshness: did we make forward progress recently?
  const ageSec = dbUpdatedAtMs != null ? Math.floor((now - dbUpdatedAtMs) / 1000) : null;
  let progressOk: boolean;
  if (healthState.phase === 'shutdown') {
    progressOk = true;
  } else if (dbUpdatedAtMs == null) {
    progressOk = inStartupGrace;
  } else {
    progressOk = ageSec! <= opts.staleSeconds;
  }
  checks.progress = {
    ok: progressOk,
    detail: {
      age_seconds: ageSec,
      stale_threshold_seconds: opts.staleSeconds,
      last_indexed_height: dbHeight ?? healthState.lastIndexedHeight,
      in_startup_grace: inStartupGrace,
    },
  };

  // ── RPC reachability: tracked by waitForRpcStatus()
  const rpcAgeSec = healthState.rpcLastOkAt
    ? Math.floor((now - healthState.rpcLastOkAt) / 1000)
    : null;
  // RPC is allowed to be temporarily unreachable; fail only if down for >2x staleness.
  const rpcOk =
    healthState.rpcReachable ||
    inStartupGrace ||
    (rpcAgeSec != null && rpcAgeSec <= opts.staleSeconds * 2);
  checks.rpc = {
    ok: rpcOk,
    detail: {
      reachable: healthState.rpcReachable,
      last_ok_age_seconds: rpcAgeSec,
      last_error: healthState.rpcLastError,
    },
  };

  const healthy = Object.values(checks).every((c) => c.ok);
  return {
    healthy,
    status: healthy ? 'ok' : 'degraded',
    uptime_seconds: uptimeSec,
    phase: healthState.phase,
    bulk_mode: healthState.bulkMode,
    checks,
  };
}

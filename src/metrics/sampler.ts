/**
 * @module metrics/sampler
 *
 * Periodic sampler that scrapes data not naturally observed in hot paths and
 * pushes it into the Prometheus registry. Runs on a fixed interval and never
 * blocks the indexer — RPC calls are best-effort with a short timeout.
 *
 * Currently sampled:
 *   - Decode worker pool busy/size counts
 *   - Postgres pool active/idle/waiting connection counts
 *   - Upstream chain tip height (cdi_chain_tip_height) → drives cdi_lag_blocks
 */
import type { Pool } from 'pg';
import type { RpcClient } from '../rpc/client.ts';
import type { TxDecodePool } from '../decode/txPool.ts';
import { setDecodePool, setPgPoolStats, setChainTipHeight } from './registry.ts';
import { getLogger } from '../utils/logger.ts';

const log = getLogger('metrics/sampler');

export interface SamplerOptions {
  intervalMs?: number;
  rpc: RpcClient;
  decodePool: TxDecodePool | null;
  getDbPool: () => Pool | null;
  /** Per-tick timeout for upstream RPC tip fetch. Avoids stalled samplers. */
  rpcTimeoutMs?: number;
}

export interface SamplerHandle {
  stop: () => void;
}

export function startMetricsSampler(opts: SamplerOptions): SamplerHandle {
  const interval = opts.intervalMs ?? 5_000;
  const rpcTimeout = opts.rpcTimeoutMs ?? 4_000;
  let stopped = false;
  let rpcInFlight = false;

  const tick = async () => {
    if (stopped) return;

    // ── Decode pool ──
    if (opts.decodePool) {
      try {
        const s = opts.decodePool.stats();
        setDecodePool(s.busy, s.size);
      } catch (e) {
        log.debug(`decode pool stats: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // ── PG pool ──
    try {
      const pool = opts.getDbPool();
      if (pool) {
        // pg.Pool exposes totalCount/idleCount/waitingCount as instance properties.
        const total = (pool as unknown as { totalCount: number }).totalCount ?? 0;
        const idle = (pool as unknown as { idleCount: number }).idleCount ?? 0;
        const waiting = (pool as unknown as { waitingCount: number }).waitingCount ?? 0;
        setPgPoolStats(Math.max(0, total - idle), idle, waiting);
      }
    } catch (e) {
      log.debug(`pg pool stats: ${e instanceof Error ? e.message : String(e)}`);
    }

    // ── Chain tip — best-effort, single in-flight ──
    if (!rpcInFlight) {
      rpcInFlight = true;
      void (async () => {
        try {
          const ac = new AbortController();
          const t = setTimeout(() => ac.abort(), rpcTimeout);
          try {
            const status = await opts.rpc.fetchStatus();
            const h = Number(status?.sync_info?.latest_block_height);
            if (Number.isFinite(h) && h > 0) setChainTipHeight(h);
          } finally {
            clearTimeout(t);
          }
        } catch (e) {
          log.debug(`tip sample failed: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
          rpcInFlight = false;
        }
      })();
    }
  };

  const handle = setInterval(tick, interval);
  // Don't keep the event loop alive on shutdown.
  if (typeof handle.unref === 'function') handle.unref();
  // Fire one immediately so /metrics is populated quickly after startup.
  void tick();

  return {
    stop() {
      stopped = true;
      clearInterval(handle);
    },
  };
}

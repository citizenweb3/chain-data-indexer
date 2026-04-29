/**
 * @module health/state
 * Shared in-memory health state mutated by the indexer (RPC client, runners,
 * shutdown hook) and read by the health HTTP server.
 *
 * Kept in its own module to avoid circular imports (rpc/client.ts and
 * health/server.ts both touch it).
 *
 * Also forwards relevant transitions to the Prometheus registry so health
 * and metrics share a single source of truth.
 */
import {
  setRpcOutage,
  setBulkModeMetric,
  setPhaseMetric,
  setIndexedHeight as setIndexedHeightMetric,
} from '../metrics/registry.ts';

export type IndexerPhase = 'starting' | 'backfill' | 'follow' | 'shutdown';

export interface HealthState {
  startedAt: number;
  phase: IndexerPhase;
  rpcReachable: boolean;
  rpcLastOkAt: number | null;
  rpcLastErrorAt: number | null;
  rpcLastError: string | null;
  lastIndexedHeight: number | null;
  bulkMode: boolean;
}

export const healthState: HealthState = {
  startedAt: Date.now(),
  phase: 'starting',
  rpcReachable: false,
  rpcLastOkAt: null,
  rpcLastErrorAt: null,
  rpcLastError: null,
  lastIndexedHeight: null,
  bulkMode: false,
};

// Initialize phase metric so /metrics shows a phase even before first transition.
setPhaseMetric('starting');

export function markRpcOk(): void {
  healthState.rpcReachable = true;
  healthState.rpcLastOkAt = Date.now();
  setRpcOutage(false);
}

export function markRpcDown(err: unknown): void {
  healthState.rpcReachable = false;
  healthState.rpcLastErrorAt = Date.now();
  healthState.rpcLastError = err instanceof Error ? err.message : String(err);
  setRpcOutage(true);
}

export function setPhase(phase: IndexerPhase): void {
  healthState.phase = phase;
  setPhaseMetric(phase);
}

export function setLastIndexedHeight(h: number): void {
  healthState.lastIndexedHeight = h;
  setIndexedHeightMetric(h);
}

export function setBulkMode(on: boolean): void {
  healthState.bulkMode = on;
  setBulkModeMetric(on);
}


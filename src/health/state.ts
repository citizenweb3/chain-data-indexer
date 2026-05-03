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

export type IndexerPhase = 'starting' | 'backfill' | 'maintenance' | 'follow' | 'shutdown';

export interface MaintenanceProgress {
  phase?: string;
  blocksDone?: number;
  blocksTotal?: number;
  partitionsDone?: number;
  partitionsTotal?: number;
  percent?: number;
  elapsedSeconds?: number;
  etaSeconds?: number | null;
}

export interface MaintenanceState {
  active: boolean;
  task: string | null;
  detail: string | null;
  currentIndex: string | null;
  startedAt: number | null;
  updatedAt: number | null;
  progress: MaintenanceProgress | null;
}

export interface HealthState {
  startedAt: number;
  phase: IndexerPhase;
  rpcReachable: boolean;
  rpcLastOkAt: number | null;
  rpcLastErrorAt: number | null;
  rpcLastError: string | null;
  lastIndexedHeight: number | null;
  bulkMode: boolean;
  maintenance: MaintenanceState;
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
  maintenance: {
    active: false,
    task: null,
    detail: null,
    currentIndex: null,
    startedAt: null,
    updatedAt: null,
    progress: null,
  },
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

export function startMaintenance(task: string, detail: string | null = null): void {
  const now = Date.now();
  healthState.maintenance = {
    active: true,
    task,
    detail,
    currentIndex: null,
    startedAt: now,
    updatedAt: now,
    progress: null,
  };
}

export function updateMaintenance(update: Partial<Omit<MaintenanceState, 'active' | 'startedAt'>>): void {
  healthState.maintenance = {
    ...healthState.maintenance,
    ...update,
    active: true,
    startedAt: healthState.maintenance.startedAt ?? Date.now(),
    updatedAt: Date.now(),
  };
}

export function clearMaintenance(): void {
  healthState.maintenance = {
    active: false,
    task: null,
    detail: null,
    currentIndex: null,
    startedAt: null,
    updatedAt: null,
    progress: null,
  };
}

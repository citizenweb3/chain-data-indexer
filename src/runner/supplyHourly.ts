import { config } from '../config.js';
import { fetchInfo, fetchPruneStatus } from '../rpc/client.js';
import { logger } from '../utils/logger.js';
import { ensureSupplyBackfillUpTo } from './supplyBackfill.js';

let archiveCheck: 'unknown' | 'archive' | 'pruned' = 'unknown';

async function ensureArchiveNode(): Promise<boolean> {
  if (archiveCheck === 'archive') return true;
  if (archiveCheck === 'pruned') return false;

  const pruneStatus = await fetchPruneStatus(10_000, 1);
  archiveCheck = pruneStatus.pruned ? 'pruned' : 'archive';

  if (archiveCheck === 'pruned') {
    logger.error('Monero supply updater requires an archival node; pruning is enabled');
    return false;
  }

  return true;
}

export async function runSupplyMaintenance(source = 'interval'): Promise<void> {
  if (!config.SUPPLY_ENABLED) return;
  if (!(await ensureArchiveNode())) return;

  const info = await fetchInfo(10_000, 1);
  if (info.busy_syncing || !info.synchronized) {
    logger.info('Skipping Monero supply maintenance while node is syncing', {
      source,
      height: info.height,
      target_height: info.target_height,
      synchronized: info.synchronized,
      busy_syncing: info.busy_syncing,
    });
    return;
  }

  const settledTip = info.height - config.SETTLEMENT_DEPTH;
  if (settledTip < 0) return;

  const written = await ensureSupplyBackfillUpTo(settledTip);
  if (written > 0) {
    logger.info('Monero supply maintenance completed', {
      source,
      settled_tip: settledTip,
      checkpoints_written: written,
    });
  }
}

export function startSupplyScheduler(): () => void {
  if (!config.SUPPLY_ENABLED) return () => undefined;

  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let inFlight = false;

  async function tick(source: string): Promise<void> {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      await runSupplyMaintenance(source);
    } catch (err) {
      logger.warn('Monero supply maintenance tick failed', { err, source });
    } finally {
      inFlight = false;
      if (!stopped) {
        timer = setTimeout(() => { void tick('interval'); }, config.SUPPLY_UPDATE_INTERVAL_MS);
        timer.unref();
      }
    }
  }

  void tick('startup');

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

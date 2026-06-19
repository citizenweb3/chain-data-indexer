import { config } from '../config.js';
import { setPhase } from '../metrics/registry.js';
import { fetchInfo } from '../rpc/client.js';
import { logger } from '../utils/logger.js';
import { syncFromProgress } from './syncRange.js';

export function followChain(): () => void {
  setPhase('follow');

  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let inFlight = false;

  async function tick(): Promise<void> {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const info = await fetchInfo();
      await syncFromProgress(info.height - 1);
    } catch (err) {
      logger.warn('Monero follow tick failed', { err });
    } finally {
      inFlight = false;
      if (!stopped) {
        timer = setTimeout(() => { void tick(); }, config.FOLLOW_POLL_INTERVAL_MS);
        timer.unref();
      }
    }
  }

  void tick();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

export async function waitForNode(pollMs = 5_000): Promise<void> {
  for (;;) {
    try {
      const info = await fetchInfo();
      logger.info('Monero node is reachable', {
        height: info.height,
        target_height: info.target_height,
        synchronized: info.synchronized,
        busy_syncing: info.busy_syncing,
      });
      return;
    } catch (err) {
      logger.warn('Cannot reach Monero node, retrying…', { err });
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

import { fetchInfo, subscribeLib } from '../rpc/client.js';
import { markBlocksFinalized } from '../sink/postgres.js';
import { getStoredBlockHeight, repairAndDeriveHeightsFromAnchor } from './heightRepair.js';
import { logger } from '../utils/logger.js';
import type { LibStreamEvent } from '../types.js';

const MIN_RECONNECT_MS = 5_000;
const MAX_RECONNECT_MS = 60_000;

/**
 * Subscribe to the LIB (Last Irreversible Block) NDJSON stream and mark
 * blocks as finalized in the database as the LIB height advances.
 *
 * Returns a cleanup function. Reconnects with exponential backoff on error.
 */
export function followLib(): () => void {
  let cleanupLib: (() => void) | null = null;
  let stopped = false;
  let reconnectDelay = MIN_RECONNECT_MS;

  async function markFinalized(headerId: string, height: number | undefined, source: string): Promise<void> {
    try {
      if (height !== undefined) {
        await repairAndDeriveHeightsFromAnchor(headerId, height, source);
      }
      const count = await markBlocksFinalized(headerId, height);
      reconnectDelay = MIN_RECONNECT_MS;
      if (count > 0) {
        logger.info('Blocks marked finalized', {
          source,
          up_to_height: height ?? null,
          header_id:    headerId.slice(0, 12) + '…',
          count,
        });
      }
    } catch (err) {
      logger.error('Failed to mark blocks finalized', { err, source, header_id: headerId });
    }
  }

  function connect(): void {
    if (stopped) return;
    logger.info('Subscribing to LIB stream for finality tracking');

    fetchInfo(4_000, 1)
      .then(async (info) => {
        if (stopped) return undefined;
        const derivedLibHeight = await getStoredBlockHeight(info.lib);
        return markFinalized(info.lib, derivedLibHeight ?? undefined, 'cryptarchia/info');
      })
      .catch((err: unknown) => {
        logger.warn('Initial LIB finality lookup failed', { err });
      });

    cleanupLib = subscribeLib(
      async (event: LibStreamEvent) => {
        await markFinalized(event.header_id, event.height, 'cryptarchia/lib-stream');
      },
      (err) => {
        if (stopped) return;
        logger.warn(`LIB stream error — reconnecting in ${reconnectDelay}ms`, { err });
        const delay = reconnectDelay;
        reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_MS);
        setTimeout(connect, delay);
      },
    );
  }

  connect();

  return () => {
    stopped = true;
    cleanupLib?.();
  };
}

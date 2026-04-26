import { subscribeBlocks, fetchInfo } from '../rpc/client.js';
import { processBlock } from '../sink/postgres.js';
import { setLastSlot } from '../db/progress.js';
import { logger } from '../utils/logger.js';
import type { BlockSseEvent } from '../types.js';

/**
 * Subscribe to the live block SSE stream and process new blocks as they arrive.
 * Returns a cleanup function. Reconnects on error after a short delay.
 */
export function followBlocks(): () => void {
  let cleanup: (() => void) | null = null;
  let stopped = false;

  function connect(): void {
    logger.info('Subscribing to live block stream');

    cleanup = subscribeBlocks(
      async (block: BlockSseEvent) => {
        try {
          await processBlock(block);
          await setLastSlot(
            block.header.slot,
            block.header.height ?? null,
          );
          logger.debug('Live block indexed', {
            slot: block.header.slot,
            height: block.header.height,
            leader: block.header.proof_of_leadership.leader_key.slice(0, 12) + '…',
          });
        } catch (err) {
          logger.error('Failed to process live block', { err });
        }
      },
      () => {
        if (stopped) return;
        logger.warn('SSE stream error — reconnecting in 5s');
        setTimeout(connect, 5_000);
      },
    );
  }

  connect();

  return () => {
    stopped = true;
    cleanup?.();
  };
}

/**
 * One-shot: wait for the node to be Online, then return current slot.
 */
export async function waitForOnline(pollMs = 5_000): Promise<number> {
  for (;;) {
    try {
      const info = await fetchInfo();
      if (info.mode === 'Online') {
        logger.info('Node is Online', { height: info.height, slot: info.slot });
        return info.slot;
      }
      logger.info('Node is still syncing', { mode: info.mode, height: info.height });
    } catch (err) {
      logger.warn('Cannot reach node, retrying…', { err });
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

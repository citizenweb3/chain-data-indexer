import { subscribeBlocks, fetchInfo } from '../rpc/client.js';
import { processBlock } from '../sink/postgres.js';
import { setLastSlot } from '../db/progress.js';
import { syncFromProgress } from './syncRange.js';
import { logger } from '../utils/logger.js';
import type { BlockSseEvent } from '../types.js';

const MIN_RECONNECT_MS = 5_000;
const MAX_RECONNECT_MS = 60_000;
const MAX_LIVE_QUEUE_DEPTH = 100;

/**
 * Subscribe to the live block SSE stream and process new blocks as they arrive.
 *
 * Before each (re-)subscription:
 *   1. Fetches the current node tip.
 *   2. Runs syncFromProgress(tip) to fill any gap since last indexed slot.
 *   3. Opens the SSE stream — minimising the pre-subscribe blind window.
 *
 * SSE events are processed through a serial promise chain so blocks are always
 * handled in order and progress never advances ahead of committed data.
 *
 * Returns a cleanup function. Reconnects on error with exponential backoff.
 */
export function followBlocks(): () => void {
  let cleanupSse: (() => void) | null = null;
  let stopped = false;
  let reconnectDelay = MIN_RECONNECT_MS;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let acceptingEvents = false;
  let streamGeneration = 0;
  let queueDepth = 0;
  // Serial queue: each SSE event is chained onto the previous one's promise
  let processingChain: Promise<void> = Promise.resolve();

  function scheduleReconnect(reason: string, err?: unknown): void {
    if (stopped || reconnectTimer) return;

    acceptingEvents = false;
    cleanupSse?.();
    cleanupSse = null;

    const delay = reconnectDelay;
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_MS);
    logger.warn(`${reason} — reconnecting in ${delay}ms`, err ? { err } : {});

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      streamGeneration++;
      processingChain = processingChain
        .catch(() => undefined)
        .then(() => connect())
        .catch((e) => {
          logger.error('connect() failed', { err: e });
        });
    }, delay);
  }

  async function connect(): Promise<void> {
    if (stopped) return;
    acceptingEvents = false;

    // ── Gap fill: catch up to current tip before opening SSE ─────────────────
    try {
      const info = await fetchInfo();
      await syncFromProgress(info.slot);
    } catch (err) {
      logger.warn('Gap-fill before SSE subscribe failed — proceeding anyway', { err });
    }

    if (stopped) return;
    logger.info('Subscribing to live block stream');

    cleanupSse = subscribeBlocks(
      (block: BlockSseEvent) => {
        if (!acceptingEvents) return;
        if (queueDepth >= MAX_LIVE_QUEUE_DEPTH) {
          scheduleReconnect('Live block queue full; applying backpressure');
          return;
        }

        const generation = streamGeneration;
        queueDepth++;

        processingChain = processingChain
          .then(async () => {
            if (stopped || !acceptingEvents || generation !== streamGeneration) return;

            await processBlock(block);
            await setLastSlot(block.header.slot, block.header.height ?? null);

            // Reset backoff on a successfully committed block.
            reconnectDelay = MIN_RECONNECT_MS;
            logger.debug('Live block indexed', {
              slot:   block.header.slot,
              height: block.header.height,
              leader: block.header.proof_of_leadership.leader_key.slice(0, 12) + '…',
            });
          })
          .catch((err) => {
            logger.error('Failed to process live block; reconnecting for gap-fill recovery', { err });
            scheduleReconnect('Live block processing failed', err);
          })
          .finally(() => {
            queueDepth--;
          });
      },
      (err) => scheduleReconnect('SSE stream error', err),
    );
    acceptingEvents = true;
  }

  connect().catch((err) => logger.error('Initial connect() failed', { err }));

  return () => {
    stopped = true;
    acceptingEvents = false;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    cleanupSse?.();
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

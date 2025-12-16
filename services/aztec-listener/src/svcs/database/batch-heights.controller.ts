import { logger } from "../../logger.js";
import {
  BATCH_HEIGHTS_FLUSH_INTERVAL_MS,
  BATCH_HEIGHTS_FLUSH_EVERY_N_BLOCKS,
} from "../../environment.js";
import {
  storeProcessedProvenBlockHeight,
  storeProcessedProposedBlockHeight,
} from "./heights.controller.js";

class BatchHeightsWriter {
  private pendingProposedHeight: number | null = null;
  private pendingProvenHeight: number | null = null;
  private batchInterval: number;
  private timer: NodeJS.Timeout | null = null;
  private blockCounter = 0;
  private flushEveryNBlocks: number;

  constructor(intervalMs = 5000, flushEveryNBlocks = 100) {
    this.batchInterval = intervalMs;
    this.flushEveryNBlocks = flushEveryNBlocks;
  }

  start() {
    this.timer = setInterval(() => this.flush(), this.batchInterval);
    logger.info(
      `Batch heights writer started (flush every ${this.batchInterval}ms)`,
    );
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.flush(); // Final flush
  }

  updateProposedHeight(height: number) {
    this.pendingProposedHeight = height;
    this.blockCounter++;
    this.checkBlockCounterFlush();
  }

  updateProvenHeight(height: number) {
    this.pendingProvenHeight = height;
    this.blockCounter++;
    this.checkBlockCounterFlush();
  }

  private checkBlockCounterFlush() {
    // Flush every N blocks to minimize progress loss risk
    if (this.blockCounter >= this.flushEveryNBlocks) {
      this.flush();
      this.blockCounter = 0;
    }
  }

  private async flush() {
    const promises = [];

    if (this.pendingProposedHeight !== null) {
      promises.push(storeProcessedProposedBlockHeight(this.pendingProposedHeight));
      logger.debug(`💾 Flushing proposed height: ${this.pendingProposedHeight}`);
      this.pendingProposedHeight = null;
    }

    if (this.pendingProvenHeight !== null) {
      promises.push(storeProcessedProvenBlockHeight(this.pendingProvenHeight));
      logger.debug(`💾 Flushing proven height: ${this.pendingProvenHeight}`);
      this.pendingProvenHeight = null;
    }

    if (promises.length > 0) {
      await Promise.all(promises);
    }
  }

  // Force immediate flush (для graceful shutdown)
  async forceFlush() {
    await this.flush();
  }
}

export const batchHeightsWriter = new BatchHeightsWriter(
  BATCH_HEIGHTS_FLUSH_INTERVAL_MS,
  BATCH_HEIGHTS_FLUSH_EVERY_N_BLOCKS,
);

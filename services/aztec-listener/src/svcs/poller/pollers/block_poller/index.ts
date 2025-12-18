import { ChicmozL2BlockFinalizationStatus } from "@chicmoz-pkg/types";
import {
  AZTEC_DISABLE_ETERNAL_CATCHUP,
  AZTEC_DISABLE_LISTEN_FOR_PROPOSED_BLOCKS,
  AZTEC_DISABLE_LISTEN_FOR_PROVEN_BLOCKS,
  BLOCK_POLL_INTERVAL_MS,
  CATCHUP_POLL_WAIT_TIME_MS,
} from "../../../../environment.js";
import { onBlock, onCatchupBlock } from "../../../../events/emitted/index.js";
import { logger } from "../../../../logger.js";
import { batchHeightsWriter } from "../../../database/batch-heights.controller.js";
import {
  getBlockHeights,
  storeBlockHeights,
  storeProcessedProposedBlockHeight,
  storeProcessedProvenBlockHeight,
} from "../../../database/heights.controller.js";
import {
  getBlock,
  getLatestProposedHeight,
  getLatestProvenHeight,
} from "../../network-client/index.js";
import { handleProvenTransactions } from "./handle-proven-block-txs.js";
import { blockFetcherPool } from "./worker-pool.js";

let timeoutId: number | undefined;
let cancelPolling = false;

// Indexing speed tracking
let catchupStartTime = 0;
let catchupBlockCount = 0;
const SPEED_LOG_INTERVAL = 50; // Log speed every 50 blocks

export const startPolling = async ({
  forceStartFromProposedHeight,
  forceStartFromProvenHeight,
}: {
  forceStartFromProposedHeight?: number;
  forceStartFromProvenHeight?: number;
} = {}) => {
  if (timeoutId) {
    throw new Error("Poller already started");
  }
  if (forceStartFromProposedHeight) {
    await storeProcessedProposedBlockHeight(forceStartFromProposedHeight - 1);
  }
  if (forceStartFromProvenHeight) {
    await storeProcessedProvenBlockHeight(forceStartFromProvenHeight - 1);
  }
  
  // Start worker pool and batch writer for high performance
  blockFetcherPool.start();
  batchHeightsWriter.start();
  
  syncRecursivePolling(true);
};

export const stopPolling = async () => {
  cancelPolling = true;
  if (timeoutId) {
    clearTimeout(timeoutId);
    timeoutId = undefined;
  }
  
  // Graceful shutdown - save progress
  blockFetcherPool.stop();
  await batchHeightsWriter.forceFlush();
  logger.info("🛑 Poller stopped gracefully");
};

const syncRecursivePolling = (isFirstRun: boolean) => {
  recursivePolling(isFirstRun).catch((e) => {
    logger.error(`🐻 error in recursive polling: ${(e as Error).stack}`);
  });
};

const recursivePolling = async (isFirstRun = false) => {
  try {
    const [chainProposedBlockHeight, chainProvenBlockHeight] =
      await Promise.all([getLatestProposedHeight(), getLatestProvenHeight()]);
    let heights = {
      ...(await getBlockHeights()),
      chainProposedBlockHeight,
      chainProvenBlockHeight,
    };

    heights = await ensureSaneValues(heights);
    const proposedProvenDiff =
      heights.chainProposedBlockHeight - heights.chainProvenBlockHeight;
    const proposedHeightDiff =
      heights.chainProposedBlockHeight - heights.processedProposedBlockHeight;
    const provenHeightDiff =
      heights.chainProvenBlockHeight - heights.processedProvenBlockHeight;
    logger.info(`🐱 ==== poller state ==== 🐱 ${
      proposedProvenDiff > 0
        ? `| ${proposedProvenDiff} proposed blocks ahead of proven`
        : ""
    }
Proposed height PROCESSED ${heights.processedProposedBlockHeight} | CHAIN ${
      heights.chainProposedBlockHeight
    } | DIFF ${proposedHeightDiff}
Proven height   PROCESSED ${heights.processedProvenBlockHeight} | CHAIN ${
      heights.chainProvenBlockHeight
    } | DIFF ${provenHeightDiff}`);
    try {
      const PREFETCH_SIZE = parseInt(process.env.BLOCK_PREFETCH_SIZE || "5", 10);
      
      while (
        !cancelPolling &&
        heights.processedProposedBlockHeight < chainProposedBlockHeight &&
        !AZTEC_DISABLE_LISTEN_FOR_PROPOSED_BLOCKS
      ) {
        // Start prefetching next blocks in parallel
        const remainingBlocks = chainProposedBlockHeight - heights.processedProposedBlockHeight;
        const prefetchCount = Math.min(PREFETCH_SIZE, remainingBlocks);
        
        // Start parallel loading of next blocks
        for (let i = 1; i <= prefetchCount; i++) {
          const nextHeight = heights.processedProposedBlockHeight + i;
          if (nextHeight <= chainProposedBlockHeight) {
            blockFetcherPool.fetchBlock(nextHeight).catch(() => {
              // Ignore prefetch errors - блок будет загружен при обработке
            });
          }
        }
        
        heights.processedProposedBlockHeight++;
        await pollProposedBlock(
          heights.processedProposedBlockHeight,
          isFirstRun,
        );
      }
    } catch (e) {
      logger.error(
        `🐼 error while processing proposed blocks: ${(e as Error).stack}`,
      );
    }
    try {
      const PREFETCH_SIZE = parseInt(process.env.BLOCK_PREFETCH_SIZE || "30", 10);
      
      while (
        !cancelPolling &&
        heights.processedProvenBlockHeight < chainProvenBlockHeight &&
        !AZTEC_DISABLE_LISTEN_FOR_PROVEN_BLOCKS
      ) {
        // Start bulk prefetch forward via worker pool
        const currentHeight = heights.processedProvenBlockHeight;
        const remainingBlocks = chainProvenBlockHeight - currentHeight;
        const prefetchCount = Math.min(PREFETCH_SIZE, remainingBlocks);
        
        // Load next blocks in parallel via worker pool
        for (let i = 1; i <= prefetchCount; i++) {
          const nextHeight = currentHeight + i;
          if (nextHeight <= chainProvenBlockHeight) {
            blockFetcherPool.prefetchBlock(nextHeight);
          }
        }
        
        heights.processedProvenBlockHeight++;
        await pollProvenBlock(heights.processedProvenBlockHeight, isFirstRun);
      }
    } catch (e) {
      logger.error(
        `🐹 error while processing proven blocks: ${(e as Error).stack}`,
      );
    }
    const nothingToProcess = proposedHeightDiff === 0 && provenHeightDiff === 0;
    if (nothingToProcess) {
      await oneEternalCatchupFetch(chainProposedBlockHeight);
    }
  } catch (e) {
    logger.error(`🐱 error while processing blocks: ${(e as Error).stack}`);
  } finally {
    logger.info(
      `🐱 waiting ${BLOCK_POLL_INTERVAL_MS / 1000}s for next poll...`,
    );
    timeoutId = setTimeout(syncRecursivePolling, BLOCK_POLL_INTERVAL_MS);
  }
};

const pollProposedBlock = async (height: number, isCatchup: boolean) => {
  const block = await internalGetBlock(height);
  if (isCatchup) {
    await onCatchupBlock(
      block,
      ChicmozL2BlockFinalizationStatus.L2_NODE_SEEN_PROPOSED,
    );
    logger.info(`🐱 catchup proposed block ${height}`);
    await new Promise((r) => setTimeout(r, CATCHUP_POLL_WAIT_TIME_MS));
  } else {
    await onBlock(
      block,
      ChicmozL2BlockFinalizationStatus.L2_NODE_SEEN_PROPOSED,
    );
  }
  batchHeightsWriter.updateProposedHeight(height); // Batching instead of direct write
};

const pollProvenBlock = async (height: number, isCatchup: boolean) => {
  const block = await internalGetBlock(height);

  if (isCatchup) {
    // Initialize timer on first catchup block
    if (catchupBlockCount === 0) {
      catchupStartTime = Date.now();
    }
    
    await onCatchupBlock(
      block,
      ChicmozL2BlockFinalizationStatus.L2_NODE_SEEN_PROVEN,
    );
    
    catchupBlockCount++;
    
    // Log speed periodically
    if (catchupBlockCount % SPEED_LOG_INTERVAL === 0) {
      const elapsedSeconds = (Date.now() - catchupStartTime) / 1000;
      const blocksPerSecond = (catchupBlockCount / elapsedSeconds).toFixed(2);
      const queueSize = blockFetcherPool.getQueueSize();
      const activeWorkers = blockFetcherPool.getActiveWorkers();
      const cacheSize = blockFetcherPool.getCacheSize();
      logger.info(`⚡ ${blocksPerSecond} blocks/s | Queue: ${queueSize} | Workers: ${activeWorkers} | Cache: ${cacheSize}`);
    } else {
      logger.info(`🐱 catchup proven block ${height}`);
    }
    
    // REMOVED: artificial delay for maximum speed
  } else {
    // Reset counters when switching from catchup to live mode
    if (catchupBlockCount > 0) {
      catchupBlockCount = 0;
      catchupStartTime = 0;
    }
    await onBlock(block, ChicmozL2BlockFinalizationStatus.L2_NODE_SEEN_PROVEN);
  }

  await handleProvenTransactions(block);
  batchHeightsWriter.updateProvenHeight(height); // Batching instead of direct write
};

const internalGetBlock = async (height: number) => {
  // ⚡ Используем worker pool который может иметь закешированный блок из prefetch
  const blockRes = await blockFetcherPool.fetchBlock(height);
  if (!blockRes) {
    throw new Error(`Block ${height} not found`);
  }
  return blockRes;
};

const ensureSaneValues = async (
  heights: Awaited<ReturnType<typeof getBlockHeights>>,
) => {
  if (heights.processedProvenBlockHeight > heights.chainProvenBlockHeight) {
    logger.warn(
      `🐷 processed proven block height is higher than chain proven height: ${heights.processedProvenBlockHeight} > ${heights.chainProvenBlockHeight}. This might be L1 reorg. Backing up DB-value to match chain proven height.`,
    );
    heights.processedProvenBlockHeight = heights.chainProvenBlockHeight;
  }
  if (heights.processedProposedBlockHeight > heights.chainProposedBlockHeight) {
    logger.warn(
      `🐷 processed proposed block height is higher than chain proposed height: ${heights.processedProposedBlockHeight} > ${heights.chainProposedBlockHeight}. This might be L2 (or even L1?) reorg. Backing up DB-value to match chain proposed height.`,
    );
    heights.processedProposedBlockHeight = heights.chainProposedBlockHeight;
  }
  if (heights.processedProposedBlockHeight < heights.chainProvenBlockHeight) {
    logger.debug(
      `🐷 processed proposed block height is lower than chain proven height: ${heights.processedProposedBlockHeight} < ${heights.chainProvenBlockHeight}. Adjusting DB-value so that block is not fetched twice.`,
    );
    heights.processedProposedBlockHeight = heights.chainProvenBlockHeight;
  }
  await storeBlockHeights(heights);
  return heights;
};

let currentEternalCatchupHeight = 1;
const oneEternalCatchupFetch = async (currentProposedHeight: number) => {
  if (AZTEC_DISABLE_ETERNAL_CATCHUP) {
    return;
  }
  // NOTE: if we have started the poller without catchup, we at least want it to eventually be in sync
  const block = await internalGetBlock(currentEternalCatchupHeight);
  if (block) {
    await onCatchupBlock(
      block,
      ChicmozL2BlockFinalizationStatus.L2_NODE_SEEN_PROPOSED,
    );
    currentEternalCatchupHeight =
      (currentEternalCatchupHeight + 1) % currentProposedHeight || 1;
    currentEternalCatchupHeight = Math.min(
      currentEternalCatchupHeight,
      currentProposedHeight,
    );
  }
};

import { L2Block } from "@aztec/aztec.js/block";
import { logger } from "../../../../logger.js";
import { getBlock } from "../../network-client/index.js";

interface BlockFetchTask {
  height: number;
  resolve: (block: L2Block) => void;
  reject: (error: Error) => void;
}

class BlockFetcherPool {
  private queue: BlockFetchTask[] = [];
  private activeWorkers = 0;
  private maxWorkers: number;
  private isRunning = false;
  private cache = new Map<number, Promise<L2Block>>(); // Cache for prefetched blocks
  private cacheMaxSize = 100;

  constructor(maxWorkers = 10) {
    this.maxWorkers = maxWorkers;
  }

  private async processQueue() {
    if (!this.isRunning) return;

    while (this.queue.length > 0 && this.activeWorkers < this.maxWorkers) {
      const task = this.queue.shift();
      if (!task) break;

      this.activeWorkers++;
      this.executeTask(task).finally(() => {
        this.activeWorkers--;
        this.processQueue();
      });
    }
  }

  private async executeTask(task: BlockFetchTask) {
    try {
      const block = await getBlock(task.height);
      if (!block) {
        throw new Error(`Block ${task.height} not found`);
      }
      task.resolve(block);
    } catch (error) {
      logger.error(`Failed to fetch block ${task.height}: ${error}`);
      task.reject(error as Error);
    }
  }

  // Method for prefetching blocks in background via worker pool
  prefetchBlock(height: number): void {
    if (this.cache.has(height) || this.cache.size >= this.cacheMaxSize) {
      return; // Already in cache or cache is full
    }

    // Start fetchBlock via worker pool and save Promise in cache
    const promise = this.fetchBlockThroughPool(height);
    this.cache.set(height, promise);

    // Remove from cache on overflow (FIFO)
    if (this.cache.size > this.cacheMaxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
  }

  // Internal method for loading via pool (without cache check)
  private fetchBlockThroughPool(height: number): Promise<L2Block> {
    return new Promise((resolve, reject) => {
      this.queue.push({ height, resolve, reject });
      this.processQueue();
    });
  }

  async fetchBlock(height: number): Promise<L2Block> {
    // Check cache first
    const cached = this.cache.get(height);
    if (cached) {
      logger.debug(`Using cached block ${height}`);
      this.cache.delete(height); // Remove from cache after use
      return cached;
    }

    // If not in cache - start via pool
    return this.fetchBlockThroughPool(height);
  }

  start() {
    this.isRunning = true;
    logger.info(`Block fetcher pool started with ${this.maxWorkers} workers`);
  }

  stop() {
    this.isRunning = false;
    this.queue = [];
    this.cache.clear(); // Clear cache
  }

  getQueueSize(): number {
    return this.queue.length;
  }

  getActiveWorkers(): number {
    return this.activeWorkers;
  }

  getCacheSize(): number {
    return this.cache.size;
  }
}

export const blockFetcherPool = new BlockFetcherPool(
  parseInt(process.env.BLOCK_FETCHER_WORKERS || "10", 10),
);

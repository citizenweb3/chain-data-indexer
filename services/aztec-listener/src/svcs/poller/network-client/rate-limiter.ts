import Bottleneck from "bottleneck";
import {
  RPC_RATE_LIMIT_RPS,
  RPC_RATE_LIMIT_MAX_CONCURRENT,
} from "../../../environment.js";

// Rate limiter to protect RPC node from overload
// Default: 500 requests per second, max 100 concurrent
export const createRateLimiter = () => {
  return new Bottleneck({
    reservoir: RPC_RATE_LIMIT_RPS,
    reservoirRefreshAmount: RPC_RATE_LIMIT_RPS,
    reservoirRefreshInterval: 1000, // every second (1000ms)
    maxConcurrent: RPC_RATE_LIMIT_MAX_CONCURRENT,
    minTime: Math.floor(1000 / RPC_RATE_LIMIT_RPS), // dynamically calculate minTime
  });
};

const limiters = new Map<string, Bottleneck>();

export const getRateLimiterForNode = (nodeUrl: string): Bottleneck => {
  if (!limiters.has(nodeUrl)) {
    limiters.set(nodeUrl, createRateLimiter());
  }
  return limiters.get(nodeUrl)!;
};

export const clearAllLimiters = () => {
  limiters.forEach((limiter) => {
    limiter.stop();
  });
  limiters.clear();
};

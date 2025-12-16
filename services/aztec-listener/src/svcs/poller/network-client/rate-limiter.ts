import Bottleneck from "bottleneck";

// Получаем настройки rate limiting из переменных окружения
const RPC_RATE_LIMIT_RPS = parseInt(
  process.env.RPC_RATE_LIMIT_RPS || "500",
  10,
);
const RPC_RATE_LIMIT_MAX_CONCURRENT = parseInt(
  process.env.RPC_RATE_LIMIT_MAX_CONCURRENT || "50",
  10,
);

// Rate limiter для защиты RPC-ноды от перегрузки
// По умолчанию: 500 запросов в секунду, максимум 50 параллельных
export const createRateLimiter = () => {
  return new Bottleneck({
    reservoir: RPC_RATE_LIMIT_RPS,
    reservoirRefreshAmount: RPC_RATE_LIMIT_RPS,
    reservoirRefreshInterval: 1000, // каждую секунду (1000ms)
    maxConcurrent: RPC_RATE_LIMIT_MAX_CONCURRENT,
    minTime: Math.floor(1000 / RPC_RATE_LIMIT_RPS), // динамически рассчитываем minTime
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

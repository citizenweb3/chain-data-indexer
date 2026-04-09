import { AztecNode, createAztecNodeClient } from "@aztec/aztec.js/node";
import { AZTEC_RPC_URLS } from "../../../environment.js";
import { AtomicCounter } from "./atomic-counter.js";
import { onL2RpcNodeError } from "../../../events/emitted/index.js";
import { logger } from "../../../logger.js";
import { getRateLimiterForNode } from "./rate-limiter.js";

export interface RpcNode {
  name: string;
  url: string;
  instance: AztecNode;
}

let allNodes: RpcNode[] = [];
let onlinePool: RpcNode[] = [];
let offlinePool: RpcNode[] = [];

// ⚡ Lock-free atomic counter вместо mutex для лучшей производительности
const nodeIndexCounter = new AtomicCounter();

const resetPools = () => {
  logger.info(
    `⚠️ ⚠️ ⚠️  Resetting node pools (online: ${onlinePool.length}, offline: ${offlinePool.length})`,
  );
  onlinePool = allNodes.map((node) => node);
  offlinePool = [];
  nodeIndexCounter.reset();
};

export const getAmountOfOnlineNodes = () => {
  return onlinePool.length;
};

export const initPool = () => {
  allNodes = AZTEC_RPC_URLS.map((node) => {
    return {
      name: node.name,
      url: node.url,
      instance: createAztecNodeClient(node.url),
    };
  });
  resetPools();
  setInterval(
    () => {
      resetPools();
    },
    60 * 60 * 1000,
  );
};

// ⚡ Lock-free round-robin (безопасно для параллельных вызовов)
export const getRpcNode = async (): Promise<RpcNode> => {
  if (onlinePool.length === 0) {
    throw new Error(
      "Node pool is empty. Ensure that initPool() has been called and the pool is properly initialized.",
    );
  }

  const index = nodeIndexCounter.increment() % onlinePool.length;
  return onlinePool[index];
};

export const getNodeUrls = (): string[] => {
  return onlinePool.map((node) => node.url);
};

export const checkValidatorStats = async () => {
  for (const node of onlinePool) {
    try {
      const stats = await node.instance.getValidatorsStats();
      logger.info(
        `Validator stats from node ${node.name}: ${JSON.stringify(stats, null, 2)}`,
      );
      return;
    } catch (e) {
      logger.warn(
        `Node ${node.name} failed to fetch validator stats: ${(e as Error).message}`,
      );
    }
  }
  logger.warn("No nodes in the pool were able to provide validator stats.");
};

export const setNodeOffline = async <K extends keyof AztecNode>(
  node: RpcNode,
  fnName: K,
  e: unknown,
  args?: Parameters<AztecNode[K]>,
): Promise<void> => {
  const nodeAlreadyOffline = offlinePool.find(
    (n) => n.name === node.name && n.url === node.url,
  );
  if (!nodeAlreadyOffline) {
    offlinePool.push(node);
  }
  logger.warn(
    `⚠️ ⚠️ ⚠️  Node ${node.name} failed to call ${fnName} with args: ${JSON.stringify(args)}. ${
      (e as Error).cause ? `Cause: ${JSON.stringify((e as Error).cause)}` : ""
    } ${
      nodeAlreadyOffline
        ? "is already marked as offline."
        : "marking it as offline."
    }`,
  );
  onL2RpcNodeError(
    {
      name: (e as Error).name ?? "UnknownName",
      message: (e as Error).message ?? "UnknownMessage",
      cause: JSON.stringify((e as Error).cause) ?? "UnknownCause",
      stack: (e as Error).stack ?? "UnknownStack",
      data: { fnName, args, error: e },
      nodeName: node.name,
    },
    node.url,
  );
  onlinePool = onlinePool.filter(
    (n) => n.name !== node.name || n.url !== node.url,
  );
  nodeIndexCounter.reset();
  if (onlinePool.length === 0) {
    logger.error("All nodes in the pool are offline. Resetting pools.");
    resetPools();
  }
};

export const getAllRpcNodes = (): RpcNode[] => {
  return allNodes;
};

/**
 * Wrapper для вызова любого метода RPC с rate limiting и retry логикой
 * @param methodName - Имя метода AztecNode для вызова
 * @param args - Аргументы метода
 * @returns Promise с результатом вызова
 */
export const callRpcMethod = async <K extends keyof AztecNode>(
  methodName: K,
  ...args: Parameters<AztecNode[K]>
): Promise<ReturnType<AztecNode[K]>> => {
  const node = await getRpcNode();
  const limiter = getRateLimiterForNode(node.url);

  try {
    const result = await limiter.schedule(() =>
      // @ts-expect-error - TypeScript не может правильно определить тип возврата
      node.instance[methodName](...args),
    );
    return result as ReturnType<AztecNode[K]>;
  } catch (e) {
    await setNodeOffline(node, methodName, e, args);
    // Retry с другой нодой (рекурсивно)
    logger.info(`Retrying ${String(methodName)} with another node...`);
    return callRpcMethod(methodName, ...args);
  }
};

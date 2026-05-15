import 'dotenv/config';
import { parentPort, workerData } from 'worker_threads';

import logger from './logger';
import { runGetPriceHistory } from './jobs/get-price-history';
import { runGetPrices } from './jobs/get-prices';
import { runRecomputeDailyStats } from './jobs/recompute-daily-stats';
import { runSyncIbcTransfers } from './jobs/sync-ibc-transfers';

type TaskName = 'sync-ibc-transfers' | 'recompute-daily-stats' | 'prices' | 'price-history';

const { taskName } = workerData as { taskName: TaskName };
const log = logger(taskName);

const runTask = async (): Promise<void> => {
  log.logInfo(`running task ${taskName}`);
  try {
    switch (taskName) {
      case 'sync-ibc-transfers':
        await runSyncIbcTransfers();
        break;
      case 'recompute-daily-stats':
        await runRecomputeDailyStats();
        break;
      case 'prices':
        await runGetPrices();
        break;
      case 'price-history':
        await runGetPriceHistory();
        break;
      default:
        throw new Error(`unknown task: ${taskName as string}`);
    }
    log.logInfo(`${taskName} completed`);
    parentPort?.postMessage(`${taskName} completed`);
    process.exit(0);
  } catch (err) {
    log.logError(`${taskName} failed`, err);
    process.exit(2);
  }
};

runTask();

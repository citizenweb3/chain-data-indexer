import 'dotenv/config';
import { parentPort, workerData } from 'worker_threads';

import logger from './logger';

type TaskName = 'sync-ibc-transfers' | 'recompute-daily-stats' | 'prices' | 'price-history';

const { taskName } = workerData as { taskName: TaskName };
const log = logger(taskName);

const stub = async (name: string): Promise<void> => {
  log.logWarn(`task ${name} not implemented yet`);
};

const runTask = async (): Promise<void> => {
  log.logInfo(`running task ${taskName}`);
  try {
    switch (taskName) {
      case 'sync-ibc-transfers':
        await stub('sync-ibc-transfers');
        break;
      case 'recompute-daily-stats':
        await stub('recompute-daily-stats');
        break;
      case 'prices':
        await stub('prices');
        break;
      case 'price-history':
        await stub('price-history');
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

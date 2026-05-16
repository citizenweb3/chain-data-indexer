import 'dotenv/config';
import { CronJob } from 'cron';
import { Worker } from 'worker_threads';

import logger from './logger';

const log = logger('indexer');

type ScheduledTask = {
  name: 'sync-ibc-transfers' | 'recompute-daily-stats' | 'prices' | 'price-history';
  schedule: string;
};

const tasks: ScheduledTask[] = [
  { name: 'sync-ibc-transfers', schedule: '*/5 * * * *' },
  { name: 'recompute-daily-stats', schedule: '1-59/5 * * * *' },
  { name: 'prices', schedule: '*/5 * * * *' },
  { name: 'price-history', schedule: '0 0 * * *' },
];

const tasksRunning: Record<string, boolean> = {};

const TASK_TIMEOUT_MS: Record<ScheduledTask['name'], number> = {
  'sync-ibc-transfers': 4 * 60 * 1000,
  'recompute-daily-stats': 4 * 60 * 1000,
  prices: 4 * 60 * 1000,
  'price-history': 30 * 60 * 1000,
};

const spawnTask = (taskName: ScheduledTask['name']): Promise<void> => {
  if (tasksRunning[taskName]) {
    log.logInfo(`${taskName} already running, skipping`);
    return Promise.resolve();
  }
  tasksRunning[taskName] = true;
  log.logInfo(`starting task ${taskName}`);

  return new Promise<void>((resolve, reject) => {
    const worker = new Worker(new URL('./task-worker.ts', import.meta.url), {
      workerData: { taskName },
      execArgv: ['--import', 'tsx'],
    });

    const timeoutMs = TASK_TIMEOUT_MS[taskName];
    const watchdog = setTimeout(() => {
      log.logError(`${taskName} watchdog fired after ${timeoutMs}ms, terminating worker`);
      worker.terminate().catch((err) => {
        log.logError(`${taskName} terminate failed`, err);
      });
    }, timeoutMs);

    worker.on('message', (msg) => {
      log.logInfo(`${taskName} message: ${msg}`);
    });
    worker.on('error', (err) => {
      clearTimeout(watchdog);
      tasksRunning[taskName] = false;
      log.logError(`${taskName} error`, err);
      reject(err);
    });
    worker.on('exit', (code) => {
      clearTimeout(watchdog);
      tasksRunning[taskName] = false;
      if (code !== 0) {
        log.logError(`${taskName} exited with code ${code}`);
        reject(new Error(`worker exited with code ${code}`));
      } else {
        resolve();
      }
    });
  });
};

const runServer = (): void => {
  log.logInfo('Starting indexer server');

  for (const task of tasks) {
    const job = new CronJob(
      task.schedule,
      async () => {
        log.logInfo(`scheduled run for ${task.name}`);
        try {
          await spawnTask(task.name);
        } catch (e) {
          log.logError(`scheduled run failed for ${task.name}`, e);
        }
      },
      null,
      true,
    );
    job.start();
    log.logInfo(`registered cron ${task.name} @ ${task.schedule}`);
  }

  for (const task of tasks) {
    spawnTask(task.name).catch((e) => log.logError(`initial run failed for ${task.name}`, e));
  }
};

runServer();

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

    worker.on('message', (msg) => {
      log.logInfo(`${taskName} message: ${msg}`);
    });
    worker.on('error', (err) => {
      tasksRunning[taskName] = false;
      log.logError(`${taskName} error`, err);
      reject(err);
    });
    worker.on('exit', (code) => {
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

import 'dotenv/config';
import { CronJob } from 'cron';
import { Worker } from 'worker_threads';

import { db } from '@/db';
import logger from './logger';
import { CHAIN_NAMES } from './tools/chains/chains';
import { CHAIN_PARAMS } from './tools/chains/params';

const log = logger('indexer');

const assertChainRegistryMatchesDb = async (): Promise<void> => {
  const dbChains = await db.chain.findMany({ select: { name: true } });
  const dbSet = new Set(dbChains.map((c) => c.name));
  // TODO(task-3.6): rename CHAIN_PARAMS → CHAIN_IDENTITIES
  const cfgSet = new Set(CHAIN_PARAMS.map((c) => c.name));

  const missingInDb = [...cfgSet].filter((n) => !dbSet.has(n));
  const missingInCfg = [...dbSet].filter((n) => !cfgSet.has(n));

  if (missingInDb.length > 0 || missingInCfg.length > 0) {
    throw new Error(
      `Chain registry mismatch. ` +
        `In CHAIN_PARAMS but not in DB: [${missingInDb.join(',')}]. ` +
        `In DB but not in CHAIN_PARAMS: [${missingInCfg.join(',')}]. ` +
        `Run yarn db:seed.`,
    );
  }
};

type ScheduledTask = {
  name: 'sync-ibc-transfers' | 'recompute-daily-stats' | 'prices' | 'price-history';
  schedule: string;
};

const tasks: ScheduledTask[] = [
  { name: 'sync-ibc-transfers', schedule: '*/1 * * * *' },
  { name: 'recompute-daily-stats', schedule: '1-59/5 * * * *' },
  { name: 'prices', schedule: '*/5 * * * *' },
  { name: 'price-history', schedule: '0 0 * * *' },
];

const tasksRunning: Record<string, boolean> = {};

const TASK_TIMEOUT_MS: Record<ScheduledTask['name'], number> = {
  'sync-ibc-transfers': 30 * 60 * 1000,
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
    const worker = new Worker(new URL('./task-worker-bootstrap.mjs', import.meta.url), {
      workerData: { taskName, chains: CHAIN_NAMES },
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

const runServer = async (): Promise<void> => {
  log.logInfo('Starting indexer server');

  await assertChainRegistryMatchesDb();
  log.logInfo('chain registry invariant ok', { chains: CHAIN_NAMES });

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

runServer().catch((e) => {
  log.logError('indexer boot failed', e);
  process.exit(1);
});

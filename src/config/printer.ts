// src/config/printer.ts
import { pruneUndefined } from '../utils/pruneUndefined.js';
import { getLogger } from '../utils/logger.js';
import { Config } from '../types.js';

const log = getLogger('config');
/**
 * Pretty-print selected configuration values via logger.
 */
export function printConfig(cfg: Config): void {
  const view = {
    rpcUrl: cfg.rpcUrl,
    range: {
      from: cfg.from ?? '(auto/resume)',
      to: cfg.resolveLatestTo ? 'latest' : (cfg.to ?? '(latest)'),
      follow: cfg.follow ?? false,
      followIntervalMs: cfg.followIntervalMs ?? 5000,
    },
    parallel: {
      shards: `${cfg.shardId + 1}/${cfg.shards}`,
      concurrency: cfg.concurrency,
    },
    network: {
      timeoutMs: cfg.timeoutMs,
      rps: cfg.rps,
      retries: cfg.retries,
      backoffMs: cfg.backoffMs,
      backoffJitter: cfg.backoffJitter,
    },
    formatting: {
      logLevel: cfg.logLevel,
      caseMode: cfg.caseMode,
      progressEveryBlocks: cfg.progressEveryBlocks,
      progressIntervalSec: cfg.progressIntervalSec,
    },
    sink: {
      kind: cfg.sinkKind,
      outPath: cfg.outPath ?? '-',
      flushEvery: cfg.flushEvery ?? 1,
    },
    resume: {
      enabled: cfg.resume ?? false,
      firstBlock: cfg.firstBlock,
    },
    postgres: cfg.pg
      ? {
          host: cfg.pg.host,
          port: cfg.pg.port,
          user: cfg.pg.user,
          database: cfg.pg.database,
          ssl: cfg.pg.ssl,
          mode: cfg.pg.mode,
          batch: {
            blocks: cfg.pg.batchBlocks,
            txs: cfg.pg.batchTxs,
            msgs: cfg.pg.batchMsgs,
            events: cfg.pg.batchEvents,
            attrs: cfg.pg.batchAttrs,
          },
          poolSize: cfg.pg.poolSize,
          progressId: cfg.pg.progressId,
        }
      : 'disabled',
  };

  const pretty = JSON.stringify(pruneUndefined(view), null, 2);
  log.info('[config]\n' + pretty);
}

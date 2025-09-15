// src/config/schema.ts
import { z } from 'zod';

// Runtime validation schema (Zod)
const PgConfigSchema = z.object({
  host: z.string().min(1).optional(),
  port: z.number().int().positive(),
  user: z.string().min(1).optional(),
  password: z.string().optional(),
  database: z.string().min(1).optional(),
  ssl: z.boolean(),
  mode: z.enum(['batch-insert', 'block-atomic']).optional(),
  batchBlocks: z.number().int().positive(),
  batchTxs: z.number().int().positive(),
  batchMsgs: z.number().int().positive(),
  batchEvents: z.number().int().positive(),
  batchAttrs: z.number().int().positive(),
  poolSize: z.number().int().positive(),
  progressId: z.string().min(1),
});

const LogLevelEnum = z.enum(['debug', 'info', 'warn', 'error', 'trace', 'silent']);
const CaseModeEnum = z.enum(['snake', 'camel']);
const SinkKindEnum = z.enum(['stdout', 'postgres']);

export const ConfigSchema = z
  .object({
    rpcUrl: z.string().url().or(z.string().startsWith('http://')).or(z.string().startsWith('https://')),
    from: z.number().int().positive().optional(),
    to: z.number().int().positive().optional(),
    shards: z.number().int().min(1),
    shardId: z.number().int().min(0),
    concurrency: z.number().int().min(1),
    timeoutMs: z.number().int().min(1),
    rps: z.number().int().min(1),
    retries: z.number().int().min(0),
    backoffMs: z.number().int().min(0),
    backoffJitter: z.number().min(0).max(1),
    logLevel: LogLevelEnum,
    resolveLatestTo: z.boolean(),
    caseMode: CaseModeEnum,
    progressEveryBlocks: z.number().int().min(1),
    progressIntervalSec: z.number().int().min(1),
    sinkKind: SinkKindEnum,
    outPath: z.string().min(1).optional(),
    flushEvery: z.number().int().min(1).optional(),
    resume: z.boolean(),
    firstBlock: z.number().int().positive(),
    follow: z.boolean(),
    followIntervalMs: z.number().int().min(100),
    pg: PgConfigSchema,
  })
  .refine((c) => !(c.from !== undefined && c.to !== undefined && c.to < c.from), {
    message: 'to must be greater than or equal to from',
    path: ['to'],
  });

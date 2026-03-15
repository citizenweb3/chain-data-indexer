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
  batchTransfers: z.number().int().positive().optional(),
  batchStakeDeleg: z.number().int().positive().optional(),
  batchStakeDistr: z.number().int().positive().optional(),
  batchWasmExec: z.number().int().positive().optional(),
  batchWasmEvents: z.number().int().positive().optional(),
  batchGovDeposits: z.number().int().positive().optional(),
  batchGovVotes: z.number().int().positive().optional(),
  batchGovProposals: z.number().int().positive().optional(),
  poolSize: z.number().int().positive(),
  progressId: z.string().min(1),
});

const ClickHouseIdentifierSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'must be a valid ClickHouse identifier');

const ChConfigSchema = z.object({
  url: z.string().url().or(z.string().startsWith('http://')).or(z.string().startsWith('https://')),
  database: ClickHouseIdentifierSchema,
  username: z.string().min(1).optional(),
  password: z.string().optional(),
});

const LogLevelEnum = z.enum(['debug', 'info', 'warn', 'error', 'trace', 'silent']);
const CaseModeEnum = z.enum(['snake', 'camel']);
const SinkKindEnum = z.enum(['stdout', 'postgres', 'clickhouse', 'null']);

export const ConfigSchema = z
  .object({
    rpcUrl: z.string().url().or(z.string().startsWith('http://')).or(z.string().startsWith('https://')),
    from: z.number().int().positive().optional(),
    to: z.number().int().positive().optional(),
    shards: z.number().int().min(1),
    shardId: z.number().int().min(0),
    concurrency: z.number().int().min(1),
    decodeWorkers: z.number().int().min(1).optional(),
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
    ch: ChConfigSchema.optional(),
    pg: PgConfigSchema.optional(),
  })
  .superRefine((c, ctx) => {
    if (c.sinkKind === 'clickhouse' && !c.ch) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'clickhouse sink requires ch configuration',
        path: ['ch'],
      });
    }
    if (c.sinkKind === 'postgres' && !c.pg) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'postgres sink requires pg configuration',
        path: ['pg'],
      });
    }
  })
  .refine((c) => !(c.from !== undefined && c.to !== undefined && c.to < c.from), {
    message: 'to must be greater than or equal to from',
    path: ['to'],
  });

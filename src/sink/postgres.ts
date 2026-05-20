// src/sink/postgres.ts
/**
 * PostgreSQL sink implementation.
 *
 * Consumes assembled block objects and persists them into a partitioned PostgreSQL schema.
 * Supports two modes:
 *  - "batch-insert": accumulate rows in memory and flush in batches within a single transaction
 *  - "block-atomic": write a single block and its related rows atomically within one transaction
 *
 * The sink is responsible for:
 *  - extracting row models from the assembled block
 *  - ensuring required partitions exist for the target height ranges
 *  - buffering rows and flushing in batches
 *  - recording sync progress (last processed height)
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Sink, SinkConfig } from './types.js';
import { createPgPool, getPgPool, closePgPool } from '../db/pg.js';
import { ensureCorePartitions } from '../db/partitions.js';
import type { PoolClient } from 'pg';
import { upsertProgress } from '../db/progress.js';
import { getLogger } from '../utils/logger.js';
import { observeFlush } from '../metrics/registry.ts';
import { makeMultiInsert, execBatchedInsert } from './pg/batch.ts';
import {
  normArray,
  pickMessages,
  pickLogs,
  attrsToPairs,
  toNum,
  buildFeeFromDecodedFee,
  collectSignersFromMessages,
  parseCoin,
  findAttr,
} from './pg/parsing.ts';
import { flushBlocks } from './pg/flushers/blocks.ts';
import { flushTxs } from './pg/flushers/txs.ts';
import { flushMsgs } from './pg/flushers/msgs.ts';
import { flushEvents } from './pg/flushers/events.ts';
import { flushTransfers } from './pg/flushers/transfers.ts';
import { flushStakeDeleg } from './pg/flushers/stake_deleg.ts';
import { flushStakeDistr } from './pg/flushers/stake_distr.ts';
import { flushWasmExec } from './pg/flushers/wasm_exec.ts';
import { flushWasmEvents } from './pg/flushers/wasm_events.ts';
import { flushGovDeposits, flushGovVotes, upsertGovProposals } from './pg/flushers/gov.ts';
import { flushIbcPackets } from './pg/flushers/ibc_packets.ts';
import { extractIbcPacketRow, type IbcPacketUpsertRow } from './pg/ibcPackets.ts';

import { insertBlocks } from './pg/inserters/blocks.ts';
import { insertTxs } from './pg/inserters/txs.ts';
import { insertMsgs } from './pg/inserters/msgs.ts';
import { insertEvents } from './pg/inserters/events.ts';
import { insertTransfers } from './pg/inserters/transfers.ts';
import { insertStakeDeleg } from './pg/inserters/stake_deleg.ts';
import { insertStakeDistr } from './pg/inserters/stake_distr.ts';
import { insertWasmExec } from './pg/inserters/wasm_exec.ts';
import { insertWasmEvents } from './pg/inserters/wasm_events.ts';

const log = getLogger('sink/postgres');

/**
 * Allowed persistence strategies for the PostgreSQL sink.
 * - `block-atomic`: each block is written in a dedicated transaction.
 * - `batch-insert`: rows are buffered and inserted in larger batches.
 */
export type PostgresMode = 'block-atomic' | 'batch-insert';

/**
 * Configuration for {@link PostgresSink}.
 * Extends the generic {@link SinkConfig} with PostgreSQL-specific options.
 * @property {object} pg                                   PostgreSQL connection options.
 * @property {string} [pg.connectionString]                Full PostgreSQL connection string (overrides discrete fields if provided).
 * @property {string} [pg.host]                            Hostname of the PostgreSQL server.
 * @property {number} [pg.port]                            Port of the PostgreSQL server.
 * @property {string} [pg.user]                            Database user.
 * @property {string} [pg.password]                        Database password.
 * @property {string} [pg.database]                        Database name.
 * @property {boolean} [pg.ssl]                            Whether to enable SSL for the connection.
 * @property {string} [pg.progressId]                      Identifier for storing sync progress checkpoints.
 * @property {PostgresMode} [mode='batch-insert']          Persistence mode.
 * @property {object} [batchSizes]                         Batch sizes per entity when `mode` is `batch-insert`.
 * @property {number} [batchSizes.blocks=1000]             Max buffered blocks before flush.
 * @property {number} [batchSizes.txs=2000]                Max buffered transactions before flush.
 * @property {number} [batchSizes.msgs=5000]               Max buffered messages before flush.
 * @property {number} [batchSizes.events=5000]             Max buffered events before flush.
 */
export interface PostgresSinkConfig extends SinkConfig {
  pg: {
    connectionString?: string;
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
    ssl?: boolean;
    progressId?: string;
    copyAppendOnlyTables?: boolean;
    bulkMode?: boolean;
  };
  mode?: PostgresMode;
  batchSizes?: {
    blocks?: number;
    txs?: number;
    msgs?: number;
    events?: number;
    transfers?: number;
    stakeDeleg?: number;
    stakeDistr?: number;
    wasmExec?: number;
    wasmEvents?: number;
    govDeposits?: number;
    govVotes?: number;
    govProposals?: number;
    ibcPackets?: number;
  };
}

interface DerivedBatch {
  minH: number;
  maxH: number;
  transfers: any[];
  stakeDeleg: any[];
  stakeDistr: any[];
  wasmExec: any[];
  wasmEvents: any[];
  govDeposits: any[];
  govVotes: any[];
  govProposals: any[];
  ibcPackets: IbcPacketUpsertRow[];
}

type BlockLine = any;

type NormalizedLog = {
  msg_index: number;
  events: Array<{ type: string; attributes: any }>;
};

/**
 * Sink that writes blocks, transactions, messages and related rows into PostgreSQL.
 * @implements {Sink}
 */
export class PostgresSink implements Sink {
  private cfg: PostgresSinkConfig;
  private mode: PostgresMode;
  private copyAppendOnlyTables: boolean;
  private bulkMode: boolean;
  private derivedQueue: DerivedBatch[] = [];
  private derivedDraining = false;
  private derivedError: Error | null = null;

  /**
   * Partition ensuring is expensive (advisory lock + many CREATE TABLE IF NOT EXISTS calls).
   * Since the indexer writes heights in order, we can safely avoid re-checking partitions
   * for already-covered 1,000,000-height ranges within a single run.
   */
  private ensuredPartitionBases = new Set<number>();
  private static readonly PARTITION_STEP = 1_000_000;

  private bufBlocks: any[] = [];
  private bufTxs: any[] = [];
  private bufMsgs: any[] = [];
  private bufEvents: any[] = [];

  private batchSizes = {
    blocks: 1000,
    txs: 2000,
    msgs: 5000,
    events: 5000,
  };

  /**
   * Create a new PostgreSQL sink.
   * @param {PostgresSinkConfig} cfg Configuration for the sink.
   */
  constructor(cfg: PostgresSinkConfig) {
    this.cfg = cfg;
    this.mode = cfg.mode ?? 'batch-insert';
    this.copyAppendOnlyTables = cfg.pg.copyAppendOnlyTables ?? false;
    this.bulkMode = cfg.pg.bulkMode ?? false;
    if (cfg.batchSizes) {
      if (cfg.batchSizes.blocks) this.batchSizes.blocks = cfg.batchSizes.blocks;
      if (cfg.batchSizes.txs) this.batchSizes.txs = cfg.batchSizes.txs;
      if (cfg.batchSizes.msgs) this.batchSizes.msgs = cfg.batchSizes.msgs;
      if (cfg.batchSizes.events) this.batchSizes.events = cfg.batchSizes.events;
    }
  }

  /**
   * Initialize the sink by creating (or reusing) a PostgreSQL connection pool.
   * Should be called once before the first {@link write}.
   * @returns {Promise<void>}
   */
  async init(): Promise<void> {
    createPgPool({ ...this.cfg.pg, applicationName: 'cosmos-indexer' });
  }

  /**
   * Ingest a single assembled block line (object or JSON string).
   * Depending on the selected mode, the block is either written atomically or buffered for batch flush.
   * Lines containing `{ error: ... }` are rejected so failed heights cannot be
   * silently counted as persisted.
   * @param {unknown} line Assembled block object or its JSON string representation.
   * @returns {Promise<void>}
   * @throws {Error} Rethrows persistence errors from underlying operations.
   */
  async write(line: any): Promise<void> {
    let obj: BlockLine;
    if (typeof line === 'string') {
      try {
        obj = JSON.parse(line);
      } catch (e) {
        throw new Error(`invalid JSON block line: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      obj = line;
    }
    if (obj?.error) throw new Error(`refusing to persist error block: ${String(obj.error)}`);

    if (this.mode === 'block-atomic') {
      await this.persistBlockAtomic(obj);
    } else {
      await this.persistBlockBuffered(obj);
    }
  }

  /**
   * Flush buffered rows if the sink operates in `batch-insert` mode.
   * No-op in `block-atomic` mode.
   * @returns {Promise<void>}
   */
  async flush(): Promise<void> {
    if (this.mode === 'batch-insert') {
      await this.flushCore();
      await this.waitDerivedDrain();
    }
  }

  /**
   * Flush any remaining buffered data and close the PostgreSQL pool.
   * Safe to call multiple times.
   * @returns {Promise<void>}
   */
  async close(): Promise<void> {
    await this.flush?.();
    await closePgPool();
  }

  private getPartitionBase(height: number): number {
    return Math.floor(height / PostgresSink.PARTITION_STEP) * PostgresSink.PARTITION_STEP;
  }

  private markPartitionsEnsured(minH: number, maxH: number): void {
    const startBase = this.getPartitionBase(minH);
    const endBase = this.getPartitionBase(maxH);
    for (let base = startBase; base <= endBase; base += PostgresSink.PARTITION_STEP) {
      this.ensuredPartitionBases.add(base);
    }
  }

  private async ensurePartitionsIfNeeded(client: PoolClient, minH: number, maxH: number): Promise<void> {
    if (!Number.isFinite(minH) || !Number.isFinite(maxH)) return;

    const startBase = this.getPartitionBase(minH);
    const endBase = this.getPartitionBase(maxH);

    let missing = false;
    for (let base = startBase; base <= endBase; base += PostgresSink.PARTITION_STEP) {
      if (!this.ensuredPartitionBases.has(base)) {
        missing = true;
        break;
      }
    }
    if (!missing) return;

    await ensureCorePartitions(client, minH, maxH, this.bulkMode);
    this.markPartitionsEnsured(minH, maxH);
  }

  /**
   * Transform an assembled block object into row-model arrays for all target tables.
   * Also computes basic derived values (e.g., signers, parsed amounts) and normalizes logs.
   *
   * @param {any} blockLine The assembled block object produced by the pipeline.
   * @returns A bag of row arrays ready for persistence plus the block height.
   */
  private extractRows(blockLine: BlockLine) {
    const height = Number(blockLine?.meta?.height);
    const time = new Date(blockLine?.meta?.time);

    const b = blockLine.block;
    const blockRow = {
      height,
      block_hash: b?.block_id?.hash ?? null,
      time,
      proposer_address: b?.block?.last_commit?.signatures?.[0]?.validator_address ?? null,
      tx_count: Array.isArray(blockLine?.txs) ? blockLine.txs.length : 0,
      size_bytes: b?.block?.size ?? null,
      last_commit_hash: b?.block?.last_commit?.block_id?.hash ?? null,
      data_hash: b?.block?.data?.hash ?? null,
      evidence_count: Array.isArray(b?.block?.evidence?.evidence) ? b.block.evidence.evidence.length : 0,
      app_hash: b?.block?.header?.app_hash ?? null,
    };

    const txRows: any[] = [];
    const msgRows: any[] = [];
    const evRows: any[] = [];
    const transfersRows: any[] = [];
    const stakeDelegRows: any[] = [];
    const stakeDistrRows: any[] = [];
    const wasmExecRows: any[] = [];
    const wasmEventsRows: any[] = [];
    const govDepositsRows: any[] = [];
    const govVotesRows: any[] = [];
    const govProposalsRows: any[] = [];
    const ibcPacketsRows: IbcPacketUpsertRow[] = [];

    const txs = Array.isArray(blockLine?.txs) ? blockLine.txs : [];
    for (const tx of txs) {
      const tx_hash = tx.hash ?? tx.txhash ?? tx.tx_hash ?? null;
      const tx_index = Number(tx.index ?? tx.tx_index ?? tx?.tx_response?.index ?? 0);
      const code = Number(tx.code ?? tx?.tx_response?.code ?? 0);
      const gas_wanted = toNum(tx.gas_wanted ?? tx?.tx_response?.gas_wanted);
      const gas_used = toNum(tx.gas_used ?? tx?.tx_response?.gas_used);
      const fee = tx.fee ?? buildFeeFromDecodedFee(tx?.decoded?.auth_info?.fee);
      const memo = tx.memo ?? tx?.decoded?.body?.memo ?? null;
      let signers: string[] | null = Array.isArray(tx.signers) ? tx.signers : null;
      const raw_tx = tx.raw_tx ?? tx?.decoded ?? tx?.raw ?? null;
      const log_summary = tx.log_summary ?? tx?.tx_response?.raw_log ?? null;

      // determine messages early so we can derive signers if needed
      const msgs = pickMessages(tx);
      if (!signers || signers.length === 0) {
        const derived = collectSignersFromMessages(msgs);
        if (derived) signers = derived;
      }
      const firstSigner = Array.isArray(signers) && signers.length ? signers[0] : null;

      txRows.push({
        tx_hash,
        height,
        tx_index,
        code,
        gas_wanted,
        gas_used,
        fee,
        memo,
        signers,
        raw_tx,
        log_summary,
        time,
      });

      // msgs already defined above
      for (let i = 0; i < msgs.length; i++) {
        const m = msgs[i];
        msgRows.push({
          tx_hash,
          msg_index: i,
          height,
          type_url: m?.['@type'] ?? m?.type_url ?? '',
          value: m,
          signer: m?.signer ?? m?.from_address ?? m?.delegator_address ?? null,
        });
      }

      for (let i = 0; i < msgs.length; i++) {
        const m = msgs[i];
        const t = m?.['@type'] ?? m?.type_url ?? '';
        if (t === '/cosmwasm.wasm.v1.MsgExecuteContract') {
          wasmExecRows.push({
            tx_hash,
            msg_index: i,
            contract: m?.contract ?? m?.contract_address ?? null,
            caller: m?.sender ?? null,
            funds: m?.funds ?? null,
            msg: m?.msg ?? null,
            success: code === 0,
            error: code === 0 ? null : (log_summary ?? null),
            gas_used: gas_used,
            height,
          });
        }

        if (t === '/cosmos.gov.v1beta1.MsgDeposit' || t === '/cosmos.gov.v1.MsgDeposit') {
          let pid: bigint;
          try {
            pid = BigInt(m?.proposal_id ?? 0);
          } catch {
            pid = 0n;
          }
          const depositor = m?.depositor ?? null;
          const coins: Array<{ denom: string; amount: string }> = Array.isArray(m?.amount) ? m.amount : [];
          if (pid > 0n && depositor) {
            for (const c of coins) {
              govDepositsRows.push({
                proposal_id: pid,
                depositor,
                denom: String(c.denom ?? ''),
                amount: String(c.amount ?? '0'),
                height,
                tx_hash,
              });
            }
          }
        }

        if (
          t === '/cosmos.gov.v1beta1.MsgVote' ||
          t === '/cosmos.gov.v1.MsgVote' ||
          t === '/cosmos.gov.v1beta1.MsgVoteWeighted' ||
          t === '/cosmos.gov.v1.MsgVoteWeighted'
        ) {
          let pid: bigint;
          try {
            pid = BigInt(m?.proposal_id ?? 0);
          } catch {
            pid = 0n;
          }
          const voter = m?.voter ?? null;
          const weighted: Array<{ option: string; weight: string }> | undefined = m?.options;
          if (pid > 0n && voter) {
            if (Array.isArray(weighted) && weighted.length > 0) {
              for (const opt of weighted) {
                // Cosmos SDK weight: integer format "1000000000000000000" (= 1.0 with 18 decimals) or decimal "1.000..."
                let w = String(opt?.weight ?? '0');
                if (/^\d+$/.test(w) && w !== '0') {
                  // Raw integer: pad to 19 chars min, insert decimal point 18 from right
                  const padded = w.padStart(19, '0');
                  const intPart = padded.slice(0, padded.length - 18) || '0';
                  const decPart = padded.slice(padded.length - 18);
                  w = `${intPart}.${decPart}`;
                }
                govVotesRows.push({
                  proposal_id: pid,
                  voter,
                  option: String(opt?.option ?? 'UNKNOWN'),
                  weight: w,
                  height,
                  tx_hash,
                });
              }
            } else {
              govVotesRows.push({
                proposal_id: pid,
                voter,
                option: String(m?.option ?? 'UNKNOWN'),
                weight: null,
                height,
                tx_hash,
              });
            }
          }
        }
      }

      const logs = pickLogs(tx);
      for (const log of logs) {
        const msg_index = Number(log?.msg_index ?? -1);
        const events = normArray<any>(log?.events);
        for (let ei = 0; ei < events.length; ei++) {
          const ev = events[ei];
          const event_type = String(ev?.type ?? 'unknown');
          const attrsPairs = attrsToPairs(ev?.attributes);
          evRows.push({
            tx_hash,
            msg_index,
            event_index: ei,
            event_type,
            attributes: attrsPairs,
            height,
          });

          if (tx_hash) {
            const ibcPacketRow = extractIbcPacketRow(attrsPairs, {
              eventType: event_type,
              height,
              txHash: tx_hash,
              relayer: firstSigner ?? null,
            });
            if (ibcPacketRow) ibcPacketsRows.push(ibcPacketRow);
          }

          if (event_type === 'transfer') {
            const sender = findAttr(attrsPairs, 'sender');
            const recipient = findAttr(attrsPairs, 'recipient');
            const amountStr = findAttr(attrsPairs, 'amount');
            const coin = parseCoin(amountStr);
            if (sender && recipient && coin) {
              transfersRows.push({
                tx_hash,
                msg_index,
                from_addr: sender,
                to_addr: recipient,
                denom: coin.denom,
                amount: coin.amount,
                height,
              });
            }
          }

          if (
            event_type === 'delegate' ||
            event_type === 'redelegate' ||
            event_type === 'unbond' ||
            event_type === 'complete_unbonding'
          ) {
            // Pull from event attributes first
            let delegator = findAttr(attrsPairs, 'delegator');
            let validator = findAttr(attrsPairs, 'validator');
            let srcVal = findAttr(attrsPairs, 'source_validator');
            let dstVal = findAttr(attrsPairs, 'destination_validator');

            // Amount may be in "amount" or "completion_amount" as a joined string like "12345uatom"
            let amountStr = findAttr(attrsPairs, 'amount') ?? findAttr(attrsPairs, 'completion_amount');
            let coin = parseCoin(amountStr ?? '');

            // Fallbacks from the original message when logs are sparse (older ABCI formats)
            // msg_index may be -1 for flat logs; only fallback when we know the specific message
            if ((!delegator || !srcVal || !dstVal || !coin) && msg_index >= 0 && msg_index < msgs.length) {
              const mm = msgs[msg_index] ?? {};
              // Delegator present in most staking messages
              if (!delegator && typeof mm.delegator_address === 'string') {
                delegator = mm.delegator_address;
              }
              // Validators by message type
              const mType = mm?.['@type'] ?? mm?.type_url ?? '';
              if (mType.includes('MsgBeginRedelegate')) {
                if (!srcVal && typeof mm.source_validator_address === 'string') srcVal = mm.source_validator_address;
                if (!dstVal && typeof mm.destination_validator_address === 'string')
                  dstVal = mm.destination_validator_address;
              } else if (mType.includes('MsgDelegate') || mType.includes('MsgUndelegate')) {
                if (!validator && typeof mm.validator_address === 'string') validator = mm.validator_address;
                if (!dstVal) dstVal = validator ?? dstVal ?? null;
              }
              // Amount/denom may be structured in the message (object or array)
              if (!coin) {
                const mAmt = mm.amount;
                if (mAmt && typeof mAmt === 'object') {
                  if (Array.isArray(mAmt) && mAmt.length > 0) {
                    const first = mAmt[0];
                    if (first && typeof first.amount === 'string' && typeof first.denom === 'string') {
                      coin = { amount: first.amount, denom: first.denom };
                    }
                  } else if (typeof mAmt.amount === 'string' && typeof mAmt.denom === 'string') {
                    coin = { amount: mAmt.amount, denom: mAmt.denom };
                  }
                }
              }
            }

            const completion_time = findAttr(attrsPairs, 'completion_time');

            stakeDelegRows.push({
              height,
              tx_hash,
              msg_index,
              event_type,
              delegator_address: delegator ?? firstSigner ?? null,
              validator_src: srcVal ?? null,
              validator_dst: dstVal ?? validator ?? null,
              denom: coin?.denom ?? null,
              amount: coin?.amount ?? null,
              completion_time: completion_time ? new Date(completion_time) : null,
            });
          }

          if (
            event_type === 'withdraw_rewards' ||
            event_type === 'withdraw_commission' ||
            event_type === 'set_withdraw_address'
          ) {
            const delegator = findAttr(attrsPairs, 'delegator');
            const validator = findAttr(attrsPairs, 'validator') ?? findAttr(attrsPairs, 'validator_address');
            const withdrawAddr =
              findAttr(attrsPairs, 'withdraw_address') ?? findAttr(attrsPairs, 'withdraw_address_old');
            // суммы могут быть как "123uatom" так и списком, но в ABCI обычно одна
            const amountStr = findAttr(attrsPairs, 'amount');
            const coin = parseCoin(amountStr ?? '');

            stakeDistrRows.push({
              height,
              tx_hash,
              msg_index,
              event_type,
              delegator_address: delegator ?? null,
              validator_address: validator ?? null,
              denom: coin?.denom ?? null,
              amount: coin?.amount ?? null,
              withdraw_address: withdrawAddr ?? null,
            });
          }

          if (event_type === 'wasm') {
            const contract = findAttr(attrsPairs, '_contract_address') ?? findAttr(attrsPairs, 'contract_address');
            if (contract) {
              wasmEventsRows.push({
                contract,
                height,
                tx_hash,
                msg_index,
                event_type,
                attributes: attrsPairs,
              });
            }
          }

          if (event_type === 'submit_proposal' || event_type === 'proposal') {
            const pidAttr = findAttr(attrsPairs, 'proposal_id');
            if (pidAttr) {
              let pid: bigint;
              try {
                pid = BigInt(pidAttr);
              } catch {
                pid = 0n;
              }
              if (pid > 0n) {
                // msg_index from log may be -1 for flat tx-level events; fallback to event attribute
                const effectiveMsgIdx = msg_index >= 0 ? msg_index : Number(findAttr(attrsPairs, 'msg_index') ?? -1);
                const mm = effectiveMsgIdx >= 0 && effectiveMsgIdx < msgs.length ? msgs[effectiveMsgIdx] : null;
                const content = mm?.content; // v1beta1: has title, description
                const innerMsg = Array.isArray(mm?.messages) ? mm.messages[0] : null; // v1: nested Any

                // v1: title/summary at top level of mm; v1beta1: inside content
                const title = mm?.title || content?.title || null;
                const summary = mm?.summary || content?.description || null;
                const proposer = mm?.proposer || mm?.signer || mm?.from_address || null;
                const proposalType = content?.['@type'] || innerMsg?.['@type'] || innerMsg?.type_url || null;

                govProposalsRows.push({
                  proposal_id: pid,
                  submitter: proposer,
                  title: title ? String(title) : null,
                  summary: summary ? String(summary) : null,
                  proposal_type: proposalType ? String(proposalType) : null,
                  status: 'deposit_period' as const,
                  submit_time: time,
                });
              }
            }
          }

          if (event_type === 'proposal_deposit') {
            // MsgDeposit deposits already extracted in msgs loop — only extract here for MsgSubmitProposal initial deposits
            const depMsgIdx = msg_index >= 0 ? msg_index : Number(findAttr(attrsPairs, 'msg_index') ?? -1);
            const originMsg = depMsgIdx >= 0 && depMsgIdx < msgs.length ? msgs[depMsgIdx] : null;
            const originType = originMsg?.['@type'] ?? originMsg?.type_url ?? '';
            if (!originType.includes('MsgDeposit') || originType.includes('MsgSubmitProposal')) {
              const pidAttr = findAttr(attrsPairs, 'proposal_id');
              const depositor = findAttr(attrsPairs, 'depositor');
              const amountStr = findAttr(attrsPairs, 'amount');
              if (pidAttr && depositor && amountStr) {
                let pid: bigint;
                try {
                  pid = BigInt(pidAttr);
                } catch {
                  pid = 0n;
                }
                const coinStrs = amountStr.split(',').filter(Boolean);
                for (const cs of coinStrs) {
                  const coin = parseCoin(cs.trim());
                  if (pid > 0n && coin) {
                    govDepositsRows.push({
                      proposal_id: pid,
                      depositor,
                      denom: coin.denom,
                      amount: coin.amount,
                      height,
                      tx_hash,
                    });
                  }
                }
              }
            }
          }
        }
      }
    }

    return {
      blockRow,
      txRows,
      msgRows,
      evRows,
      transfersRows,
      stakeDelegRows,
      stakeDistrRows,
      wasmExecRows,
      wasmEventsRows,
      govDepositsRows,
      govVotesRows,
      govProposalsRows,
      ibcPacketsRows,
      height,
    };
  }

  /**
   * Persist a single block atomically within one database transaction.
   * @deprecated Use batch-insert mode instead. block-atomic does not support two-stream pipeline.
   * @param {any} blockLine Assembled block object.
   * @returns {Promise<void>}
   * @throws {Error} When any insert fails; the transaction is rolled back.
   */
  private async persistBlockAtomic(blockLine: BlockLine): Promise<void> {
    log.warn('block-atomic mode is deprecated — use batch-insert for optimal performance');
    const pool = getPgPool();
    // Gov fields (govDepositsRows, govVotesRows, govProposalsRows) intentionally omitted —
    // governance data is only supported via the buffered/derived-stream path.
    const {
      blockRow,
      txRows,
      msgRows,
      evRows,
      transfersRows,
      stakeDelegRows,
      stakeDistrRows,
      wasmExecRows,
      wasmEventsRows,
      ibcPacketsRows,
      height,
    } = this.extractRows(blockLine);

    const client = await pool.connect();
    try {
      await this.ensurePartitionsIfNeeded(client, height, height);
      await client.query('BEGIN');
      await insertBlocks(client, [blockRow]);
      if (txRows.length) await insertTxs(client, txRows);
      if (msgRows.length) await insertMsgs(client, msgRows);
      if (evRows.length) await insertEvents(client, evRows);
      if (transfersRows.length) await insertTransfers(client, transfersRows);
      if (stakeDelegRows.length) await insertStakeDeleg(client, stakeDelegRows);
      if (stakeDistrRows.length) await insertStakeDistr(client, stakeDistrRows);
      if (wasmExecRows.length) await insertWasmExec(client, wasmExecRows);
      if (wasmEventsRows.length) await insertWasmEvents(client, wasmEventsRows);
      if (ibcPacketsRows.length) await flushIbcPackets(client, ibcPacketsRows);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Buffer core rows from the given block and push derived rows to the async drain queue.
   * Core tables are flushed synchronously when thresholds are met; derived tables drain asynchronously.
   * @param {any} blockLine Assembled block object.
   * @returns {Promise<void>}
   */
  private async persistBlockBuffered(blockLine: BlockLine): Promise<void> {
    // Propagate any async error from the derived stream
    if (this.derivedError) {
      const err = this.derivedError;
      this.derivedError = null;
      throw err;
    }

    // Backpressure: wait if derived queue is too deep
    if (this.derivedQueue.length > 10) {
      await this.waitDerivedDrain(10);
    }

    const {
      blockRow,
      txRows,
      msgRows,
      evRows,
      transfersRows,
      stakeDelegRows,
      stakeDistrRows,
      wasmExecRows,
      wasmEventsRows,
      govDepositsRows,
      govVotesRows,
      govProposalsRows,
      ibcPacketsRows,
    } = this.extractRows(blockLine);

    // Buffer core rows
    this.bufBlocks.push(blockRow);
    this.bufTxs.push(...txRows);
    this.bufMsgs.push(...msgRows);
    this.bufEvents.push(...evRows);

    // Check if core needs flushing
    const needCoreFlush =
      this.bufBlocks.length >= this.batchSizes.blocks ||
      this.bufTxs.length >= this.batchSizes.txs ||
      this.bufMsgs.length >= this.batchSizes.msgs ||
      this.bufEvents.length >= this.batchSizes.events;

    if (needCoreFlush) {
      await this.flushCore();
    }

    // Push derived batch to queue (only if there's data)
    if (
      transfersRows.length ||
      stakeDelegRows.length ||
      stakeDistrRows.length ||
      wasmExecRows.length ||
      wasmEventsRows.length ||
      govDepositsRows.length ||
      govVotesRows.length ||
      govProposalsRows.length ||
      ibcPacketsRows.length
    ) {
      const heights = [
        ...transfersRows.map((r: any) => r.height),
        ...stakeDelegRows.map((r: any) => r.height),
        ...stakeDistrRows.map((r: any) => r.height),
        ...wasmExecRows.map((r: any) => r.height),
        ...wasmEventsRows.map((r: any) => r.height),
        ...govDepositsRows.map((r: any) => r.height),
        ...govVotesRows.map((r: any) => r.height),
        ...govProposalsRows.map((r: any) => r.height),
        ...ibcPacketsRows.flatMap((r) => [r.height_send, r.height_recv, r.height_ack]),
      ].filter((h): h is number => Number.isFinite(h));

      if (heights.length > 0) {
        let minH = heights[0]!;
        let maxH = heights[0]!;
        for (let i = 1; i < heights.length; i++) {
          if (heights[i]! < minH) minH = heights[i]!;
          if (heights[i]! > maxH) maxH = heights[i]!;
        }

        this.derivedQueue.push({
          minH,
          maxH,
          transfers: transfersRows,
          stakeDeleg: stakeDelegRows,
          stakeDistr: stakeDistrRows,
          wasmExec: wasmExecRows,
          wasmEvents: wasmEventsRows,
          govDeposits: govDepositsRows,
          govVotes: govVotesRows,
          govProposals: govProposalsRows,
          ibcPackets: ibcPacketsRows,
        });
      }
    }

    // Trigger derived drain (non-blocking)
    setImmediate(() => this.drainDerived());
  }

  /**
   * Flush core table buffers (blocks, txs, msgs, events) and update sync progress
   * in a single transaction.
   * @returns {Promise<void>}
   * @throws {Error} Rethrows database errors; buffers remain intact if the transaction fails.
   */
  private async flushCore(): Promise<void> {
    if (
      this.bufBlocks.length === 0 &&
      this.bufTxs.length === 0 &&
      this.bufMsgs.length === 0 &&
      this.bufEvents.length === 0
    )
      return;

    const pool = getPgPool();
    const client = await pool.connect();
    const copyOpts = { useCopy: this.bulkMode };

    try {
      const heights = [
        ...this.bufBlocks.map((r) => r.height),
        ...this.bufTxs.map((r) => r.height),
        ...this.bufMsgs.map((r) => r.height),
        ...this.bufEvents.map((r) => r.height),
      ].filter((h): h is number => Number.isFinite(h));

      if (heights.length === 0) {
        return;
      }

      let minH = heights[0]!;
      let maxH = heights[0]!;
      for (let i = 1; i < heights.length; i++) {
        if (heights[i]! < minH) minH = heights[i]!;
        if (heights[i]! > maxH) maxH = heights[i]!;
      }

      const snapshotCounts = {
        blocks: this.bufBlocks.length,
        txs: this.bufTxs.length,
        msgs: this.bufMsgs.length,
        events: this.bufEvents.length,
      };

      await this.ensurePartitionsIfNeeded(client, minH, maxH);

      await client.query('BEGIN');
      await client.query(`SET LOCAL statement_timeout = '5min'`);
      await client.query(`SET LOCAL lock_timeout = '5s'`);

      const t0 = Date.now();

      const blocksToFlush = this.bufBlocks;
      const txsToFlush = this.bufTxs;
      const msgsToFlush = this.bufMsgs;
      const eventsToFlush = this.bufEvents;

      await flushBlocks(client, blocksToFlush, copyOpts);
      await flushTxs(client, txsToFlush, copyOpts);
      await flushMsgs(client, msgsToFlush, copyOpts);
      await flushEvents(client, eventsToFlush, copyOpts);

      await upsertProgress(client, this.cfg.pg?.progressId ?? 'default', maxH);

      await client.query('COMMIT');
      this.bufBlocks = [];
      this.bufTxs = [];
      this.bufMsgs = [];
      this.bufEvents = [];
      const tookMs = Date.now() - t0;
      observeFlush('core', tookMs / 1000, {
        blocks: snapshotCounts.blocks,
        transactions: snapshotCounts.txs,
        messages: snapshotCounts.msgs,
        events: snapshotCounts.events,
      });
      log.info('flushed core', {
        span: `[${minH}, ${maxH}]`,
        rows: snapshotCounts,
        tookMs,
      });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Asynchronously drain the derived batch queue. Each batch is written in its own transaction.
   * Uses try/finally to ensure `derivedDraining` is always reset, preventing permanent stalls.
   * @returns {Promise<void>}
   */
  private async drainDerived(): Promise<void> {
    if (this.derivedDraining || this.derivedQueue.length === 0) return;
    this.derivedDraining = true;

    const batch = this.derivedQueue.shift()!;
    const pool = getPgPool();
    const client = await pool.connect();
    const copyOpts = { useCopy: this.bulkMode };

    try {
      await this.ensurePartitionsIfNeeded(client, batch.minH, batch.maxH);

      await client.query('BEGIN');
      await client.query(`SET LOCAL statement_timeout = '5min'`);
      await client.query(`SET LOCAL lock_timeout = '5s'`);

      const t0 = Date.now();

      // Derived tables always use INSERT with ON CONFLICT (not COPY).
      // Reason: blockchain events can produce duplicate PK rows within one batch
      // (e.g. multi-send generates multiple transfers with same PK in one msg).
      // COPY FROM has no ON CONFLICT support and would fail on such duplicates.
      await flushTransfers(client, batch.transfers);
      await flushStakeDeleg(client, batch.stakeDeleg);
      await flushStakeDistr(client, batch.stakeDistr);
      await flushWasmExec(client, batch.wasmExec);
      await flushWasmEvents(client, batch.wasmEvents);
      await flushGovDeposits(client, batch.govDeposits);
      await flushGovVotes(client, batch.govVotes);
      await upsertGovProposals(client, batch.govProposals);
      await flushIbcPackets(client, batch.ibcPackets);

      await client.query('COMMIT');
      const tookMs = Date.now() - t0;
      observeFlush('derived', tookMs / 1000, {
        transfers: batch.transfers.length,
        stake_deleg: batch.stakeDeleg.length,
        stake_distr: batch.stakeDistr.length,
        wasm_exec: batch.wasmExec.length,
        wasm_events: batch.wasmEvents.length,
        gov_deposits: batch.govDeposits.length,
        gov_votes: batch.govVotes.length,
        gov_proposals: batch.govProposals.length,
        ibc_packets: batch.ibcPackets.length,
      });
      log.debug('flushed derived', {
        span: `[${batch.minH}, ${batch.maxH}]`,
        tookMs,
        queueRemaining: this.derivedQueue.length,
      });
    } catch (e) {
      await client.query('ROLLBACK');
      // Re-queue the failed batch so data is not lost
      this.derivedQueue.unshift(batch);
      this.derivedError = e instanceof Error ? e : new Error(String(e));
      log.error('drainDerived failed (batch re-queued): %s', this.derivedError.message);
    } finally {
      client.release();
      this.derivedDraining = false;
    }

    // Continue draining if more batches
    if (this.derivedQueue.length > 0) {
      setImmediate(() => this.drainDerived());
    }
  }

  /**
   * Wait until the derived queue drains to at most `maxQueueLen` entries.
   * Propagates any errors from the derived stream.
   * @param {number} [maxQueueLen=0] Maximum acceptable queue length.
   * @returns {Promise<void>}
   */
  async waitDerivedDrain(maxQueueLen = 0): Promise<void> {
    // Kick off draining in case no setImmediate is pending
    this.drainDerived();
    while (this.derivedQueue.length > maxQueueLen || this.derivedDraining) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      // Propagate errors during wait
      if (this.derivedError) {
        const err = this.derivedError;
        this.derivedError = null;
        throw err;
      }
      // Re-trigger drain in case it stopped
      this.drainDerived();
    }
  }

  /**
   * Toggle bulk mode (COPY-based inserts) at runtime.
   * @param {boolean} enabled Whether to enable bulk mode.
   */
  setBulkMode(enabled: boolean): void {
    this.bulkMode = enabled;
    log.info('bulk mode set to %s', enabled);
  }
}

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
import { flushAttrs } from './pg/flushers/attrs.ts';
import { flushTransfers } from './pg/flushers/transfers.ts';
import { flushStakeDeleg } from './pg/flushers/stake_deleg.ts';
import { flushStakeDistr } from './pg/flushers/stake_distr.ts';
import { flushWasmExec } from './pg/flushers/wasm_exec.ts';
import { flushWasmEvents } from './pg/flushers/wasm_events.ts';
import { flushGovDeposits, flushGovVotes, upsertGovProposals } from './pg/flushers/gov.ts';

import { insertBlocks } from './pg/inserters/blocks.ts';
import { insertTxs } from './pg/inserters/txs.ts';
import { insertMsgs } from './pg/inserters/msgs.ts';
import { insertEvents } from './pg/inserters/events.ts';
import { insertAttrs } from './pg/inserters/attrs.ts';
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
 * @property {number} [batchSizes.attrs=10000]             Max buffered event attributes before flush.
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
  };
  mode?: PostgresMode;
  batchSizes?: {
    blocks?: number;
    txs?: number;
    msgs?: number;
    events?: number;
    attrs?: number;
  };
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

  private bufBlocks: any[] = [];
  private bufTxs: any[] = [];
  private bufMsgs: any[] = [];
  private bufEvents: any[] = [];
  private bufAttrs: any[] = [];
  private bufTransfers: any[] = [];
  private bufStakeDeleg: any[] = [];
  private bufStakeDistr: any[] = [];
  private bufWasmExec: any[] = [];
  private bufWasmEvents: any[] = [];
  private bufGovDeposits: any[] = [];
  private bufGovVotes: any[] = [];
  private bufGovProposals: any[] = [];

  private batchSizes = {
    blocks: 1000,
    txs: 2000,
    msgs: 5000,
    events: 5000,
    attrs: 10000,
    transfers: 5000,
    stakeDeleg: 5000,
    stakeDistr: 5000,
    wasmExec: 5000,
    wasmEvents: 5000,
    govDeposits: 5000,
    govVotes: 5000,
    govProposals: 1000,
  };

  /**
   * Create a new PostgreSQL sink.
   * @param {PostgresSinkConfig} cfg Configuration for the sink.
   */
  constructor(cfg: PostgresSinkConfig) {
    this.cfg = cfg;
    this.mode = cfg.mode ?? 'batch-insert';
    if (cfg.batchSizes) Object.assign(this.batchSizes, cfg.batchSizes);
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
   * Lines containing `{ error: ... }` are ignored.
   * @param {unknown} line Assembled block object or its JSON string representation.
   * @returns {Promise<void>}
   * @throws {Error} Rethrows persistence errors from underlying operations.
   */
  async write(line: any): Promise<void> {
    let obj: BlockLine;
    if (typeof line === 'string') {
      try {
        obj = JSON.parse(line);
      } catch {
        return;
      }
    } else {
      obj = line;
    }
    if (obj?.error) return;

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
      await this.flushAll();
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

  /**
   * Transform an assembled block object into row-model arrays for all target tables.
   * Also computes basic derived values (e.g., signers, parsed amounts) and normalizes logs.
   *
   * @param {any} blockLine The assembled block object produced by the pipeline.
   * @returns {{
   *   blockRow: any,
   *   txRows: any[],
   *   msgRows: any[],
   *   evRows: any[],
   *   attrRows: any[],
   *   transfersRows: any[],
   *   stakeDelegRows: any[],
   *   stakeDistrRows: any[],
   *   wasmExecRows: any[],
   *   wasmEventsRows: any[],
   *   height: number
   * }} A bag of row arrays ready for persistence plus the block height.
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
    const attrRows: any[] = [];
    const transfersRows: any[] = [];
    const stakeDelegRows: any[] = [];
    const stakeDistrRows: any[] = [];
    const wasmExecRows: any[] = [];
    const wasmEventsRows: any[] = [];
    const govDepositsRows: any[] = [];
    const govVotesRows: any[] = [];
    const govProposalsRows: any[] = [];

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

          for (const { key, value } of attrsPairs) {
            attrRows.push({
              tx_hash,
              msg_index,
              event_index: ei,
              key,
              value,
              height,
            });
          }
        }
      }
    }

    // Governance rows extraction
    const gov = blockLine?.gov ?? {};
    if (Array.isArray(gov.deposits)) {
      for (const r of gov.deposits) govDepositsRows.push(r);
    }
    if (Array.isArray(gov.votes)) {
      for (const r of gov.votes) govVotesRows.push(r);
    }
    if (Array.isArray(gov.proposals)) {
      for (const r of gov.proposals) govProposalsRows.push(r);
    }

    return {
      blockRow,
      txRows,
      msgRows,
      evRows,
      attrRows,
      transfersRows,
      stakeDelegRows,
      stakeDistrRows,
      wasmExecRows,
      wasmEventsRows,
      govDepositsRows,
      govVotesRows,
      govProposalsRows,
      height,
    };
  }

  /**
   * Persist a single block atomically within one database transaction.
   * Ensures partitions for the block's height exist, writes all related rows,
   * and commits on success or rolls back on error.
   * @param {any} blockLine Assembled block object.
   * @returns {Promise<void>}
   * @throws {Error} When any insert fails; the transaction is rolled back.
   */
  private async persistBlockAtomic(blockLine: BlockLine): Promise<void> {
    const pool = getPgPool();
    const {
      blockRow,
      txRows,
      msgRows,
      evRows,
      attrRows,
      transfersRows,
      stakeDelegRows,
      stakeDistrRows,
      wasmExecRows,
      wasmEventsRows,
      height,
    } = this.extractRows(blockLine);

    const client = await pool.connect();
    try {
      await ensureCorePartitions(client, height);
      await client.query('BEGIN');
      await insertBlocks(client, [blockRow]);
      if (txRows.length) await insertTxs(client, txRows);
      if (msgRows.length) await insertMsgs(client, msgRows);
      if (evRows.length) await insertEvents(client, evRows);
      if (attrRows.length) await insertAttrs(client, attrRows);
      if (transfersRows.length) await insertTransfers(client, transfersRows);
      if (stakeDelegRows.length) await insertStakeDeleg(client, stakeDelegRows);
      if (stakeDistrRows.length) await insertStakeDistr(client, stakeDistrRows);
      if (wasmExecRows.length) await insertWasmExec(client, wasmExecRows);
      if (wasmEventsRows.length) await insertWasmEvents(client, wasmEventsRows);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Buffer rows derived from the given block and trigger a batch flush once any buffer
   * exceeds its configured threshold.
   * @param {any} blockLine Assembled block object.
   * @returns {Promise<void>}
   */
  private async persistBlockBuffered(blockLine: BlockLine): Promise<void> {
    const {
      blockRow,
      txRows,
      msgRows,
      evRows,
      attrRows,
      transfersRows,
      stakeDelegRows,
      stakeDistrRows,
      wasmExecRows,
      wasmEventsRows,
      govDepositsRows,
      govVotesRows,
      govProposalsRows,
    } = this.extractRows(blockLine);

    this.bufBlocks.push(blockRow);
    this.bufTxs.push(...txRows);
    this.bufMsgs.push(...msgRows);
    this.bufEvents.push(...evRows);
    this.bufAttrs.push(...attrRows);

    this.bufTransfers.push(...transfersRows);
    this.bufStakeDeleg.push(...stakeDelegRows);
    this.bufStakeDistr.push(...stakeDistrRows);
    this.bufWasmExec.push(...wasmExecRows);
    this.bufWasmEvents.push(...wasmEventsRows);

    this.bufGovDeposits.push(...govDepositsRows);
    this.bufGovVotes.push(...govVotesRows);
    this.bufGovProposals.push(...govProposalsRows);

    const needFlush =
      this.bufBlocks.length >= this.batchSizes.blocks ||
      this.bufTxs.length >= this.batchSizes.txs ||
      this.bufMsgs.length >= this.batchSizes.msgs ||
      this.bufEvents.length >= this.batchSizes.events ||
      this.bufAttrs.length >= this.batchSizes.attrs ||
      this.bufTransfers.length >= this.batchSizes.transfers ||
      this.bufStakeDeleg.length >= this.batchSizes.stakeDeleg ||
      this.bufStakeDistr.length >= this.batchSizes.stakeDistr ||
      this.bufWasmExec.length >= this.batchSizes.wasmExec ||
      this.bufWasmEvents.length >= this.batchSizes.wasmEvents ||
      this.bufGovDeposits.length >= this.batchSizes.govDeposits ||
      this.bufGovVotes.length >= this.batchSizes.govVotes ||
      this.bufGovProposals.length >= this.batchSizes.govProposals;

    if (needFlush) {
      const counts = {
        blocks: this.bufBlocks.length,
        txs: this.bufTxs.length,
        msgs: this.bufMsgs.length,
        events: this.bufEvents.length,
        attrs: this.bufAttrs.length,
        transfers: this.bufTransfers.length,
        stakeDeleg: this.bufStakeDeleg.length,
        stakeDistr: this.bufStakeDistr.length,
        wasmExec: this.bufWasmExec.length,
        wasmEvents: this.bufWasmEvents.length,
        govDeposits: this.bufGovDeposits.length,
        govVotes: this.bufGovVotes.length,
        govProposals: this.bufGovProposals.length,
      };
      log.debug(
        `flush trigger: blocks=${counts.blocks} txs=${counts.txs} msgs=${counts.msgs} events=${counts.events} attrs=${counts.attrs}`,
      );
      await this.flushAll();
    }
  }

  /**
   * Flush all buffered rows in a single transaction, creating any missing partitions
   * for the covered height range. On success, clears the buffers and updates the sync progress.
   * @returns {Promise<void>}
   * @throws {Error} Rethrows database errors; buffers remain intact if the transaction fails.
   */
  private async flushAll(): Promise<void> {
    if (
      this.bufBlocks.length === 0 &&
      this.bufTxs.length === 0 &&
      this.bufMsgs.length === 0 &&
      this.bufEvents.length === 0 &&
      this.bufAttrs.length === 0 &&
      this.bufTransfers.length === 0 &&
      this.bufStakeDeleg.length === 0 &&
      this.bufStakeDistr.length === 0 &&
      this.bufWasmExec.length === 0 &&
      this.bufWasmEvents.length === 0 &&
      this.bufGovDeposits.length === 0 &&
      this.bufGovVotes.length === 0 &&
      this.bufGovProposals.length === 0
    )
      return;

    const pool = getPgPool();
    const client = await pool.connect();
    try {
      const heights: number[] = [
        ...this.bufBlocks.map((r) => r.height),
        ...this.bufTxs.map((r) => r.height),
        ...this.bufMsgs.map((r) => r.height),
        ...this.bufEvents.map((r) => r.height),
        ...this.bufAttrs.map((r) => r.height),
        ...this.bufTransfers.map((r) => r.height),
        ...this.bufStakeDeleg.map((r) => r.height),
        ...this.bufStakeDistr.map((r) => r.height),
        ...this.bufWasmExec.map((r) => r.height),
        ...this.bufWasmEvents.map((r) => r.height),
        ...this.bufGovDeposits.map((r) => r.height),
        ...this.bufGovVotes.map((r) => r.height),
        ...this.bufGovProposals.map((r) => r.height),
      ].filter((h): h is number => Number.isFinite(h)); // ← фильтр

      if (heights.length === 0) {
        client.release();
        return;
      }

      const minH = Math.min(...heights);
      const maxH = Math.max(...heights);

      log.debug('ensure partitions', {
        minH,
        maxH,
        counts: {
          blocks: this.bufBlocks.length,
          txs: this.bufTxs.length,
          msgs: this.bufMsgs.length,
          events: this.bufEvents.length,
          attrs: this.bufAttrs.length,
          govDeposits: this.bufGovDeposits.length,
          govVotes: this.bufGovVotes.length,
          govProposals: this.bufGovProposals.length,
        },
      });
      const snapshotCounts = {
        blocks: this.bufBlocks.length,
        txs: this.bufTxs.length,
        msgs: this.bufMsgs.length,
        events: this.bufEvents.length,
        attrs: this.bufAttrs.length,
        transfers: this.bufTransfers.length,
        stakeDeleg: this.bufStakeDeleg.length,
        stakeDistr: this.bufStakeDistr.length,
        wasmExec: this.bufWasmExec.length,
        wasmEvents: this.bufWasmEvents.length,
        govDeposits: this.bufGovDeposits.length,
        govVotes: this.bufGovVotes.length,
        govProposals: this.bufGovProposals.length,
      };
      const t0 = Date.now();

      await ensureCorePartitions(client, minH, maxH);

      await client.query('BEGIN');

      await flushBlocks(client, this.bufBlocks);
      this.bufBlocks = [];
      await flushTxs(client, this.bufTxs);
      this.bufTxs = [];
      await flushMsgs(client, this.bufMsgs);
      this.bufMsgs = [];
      await flushEvents(client, this.bufEvents);
      this.bufEvents = [];
      await flushAttrs(client, this.bufAttrs);
      this.bufAttrs = [];

      await flushTransfers(client, this.bufTransfers);
      this.bufTransfers = [];
      await flushStakeDeleg(client, this.bufStakeDeleg);
      this.bufStakeDeleg = [];
      await flushStakeDistr(client, this.bufStakeDistr);
      this.bufStakeDistr = [];
      await flushWasmExec(client, this.bufWasmExec);
      this.bufWasmExec = [];
      await flushWasmEvents(client, this.bufWasmEvents);
      this.bufWasmEvents = [];

      await flushGovDeposits(client, this.bufGovDeposits);
      this.bufGovDeposits = [];
      await flushGovVotes(client, this.bufGovVotes);
      this.bufGovVotes = [];
      await upsertGovProposals(client, this.bufGovProposals);
      this.bufGovProposals = [];

      await upsertProgress(client, this.cfg.pg?.progressId ?? 'default', maxH);

      await client.query('COMMIT');
      const tookMs = Date.now() - t0;
      log.info('flushed', {
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
}

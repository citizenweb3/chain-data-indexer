/* eslint-disable @typescript-eslint/no-explicit-any */
import { Sink, SinkConfig } from './types.js';
import { getTriggeredFlushBuffers } from './flush-trigger.js';
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

type BlockLine = any;

type FlushBufferName =
  | 'blocks'
  | 'txs'
  | 'msgs'
  | 'events'
  | 'attrs'
  | 'transfers'
  | 'stakeDeleg'
  | 'stakeDistr'
  | 'wasmExec'
  | 'wasmEvents'
  | 'govDeposits'
  | 'govVotes'
  | 'govProposals';

type FlushBufferCounts = Record<FlushBufferName, number>;
type BatchSizes = Record<FlushBufferName, number>;
type QueryResultRow = Record<string, unknown>;

type ClickHouseInsertParams = {
  table: string;
  values: QueryResultRow[];
  format: 'JSONEachRow';
};

type ClickHouseQueryParams = {
  query: string;
  format: 'JSONEachRow';
};

type ClickHouseQueryResult = {
  json<T = QueryResultRow[]>(): Promise<T>;
};

type ClickHouseClientLike = {
  ping(): Promise<unknown>;
  insert(params: ClickHouseInsertParams): Promise<unknown>;
  query(params: ClickHouseQueryParams): Promise<ClickHouseQueryResult>;
  close(): Promise<void>;
};

type ClickHouseCreateClient = (cfg: Record<string, unknown>) => ClickHouseClientLike;

type ClickHouseConfig = {
  url?: string;
  host?: string;
  username?: string;
  password?: string;
  database?: string;
  client?: ClickHouseClientLike;
  createClient?: ClickHouseCreateClient;
  tables?: Partial<Record<FlushBufferName, string>>;
};

type ClickHouseSinkConfig = SinkConfig & {
  ch?: ClickHouseConfig;
  clickhouse?: ClickHouseConfig;
};

type BufferState = Record<FlushBufferName, any[]>;

type ExtractedRows = {
  blockRow: any;
  txRows: any[];
  msgRows: any[];
  evRows: any[];
  attrRows: any[];
  transfersRows: any[];
  stakeDelegRows: any[];
  stakeDistrRows: any[];
  wasmExecRows: any[];
  wasmEventsRows: any[];
  govDepositsRows: any[];
  govVotesRows: any[];
  govProposalsRows: any[];
  height: number;
};

const FLUSH_ORDER: FlushBufferName[] = [
  'blocks',
  'txs',
  'msgs',
  'events',
  'attrs',
  'transfers',
  'stakeDeleg',
  'stakeDistr',
  'wasmExec',
  'wasmEvents',
  'govDeposits',
  'govVotes',
  'govProposals',
];

const DEFAULT_BATCH_SIZES: BatchSizes = {
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

const DEFAULT_TABLES: Record<FlushBufferName, string> = {
  blocks: 'core.blocks',
  txs: 'core.transactions',
  msgs: 'core.messages',
  events: 'core.events',
  attrs: 'core.event_attrs',
  transfers: 'bank.transfers',
  stakeDeleg: 'stake.delegation_events',
  stakeDistr: 'stake.distribution_events',
  wasmExec: 'wasm.executions',
  wasmEvents: 'wasm.events',
  govDeposits: 'gov.deposits',
  govVotes: 'gov.votes',
  govProposals: 'gov.proposals',
};

const DEFAULT_CLIENT_SETTINGS = {
  date_time_input_format: 'best_effort',
} as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
}

function normalizeJsonValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeJsonValue(item));
  }

  if (isPlainObject(value)) {
    const normalized: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      normalized[key] = normalizeJsonValue(nestedValue);
    }
    return normalized;
  }

  return value;
}

function serializeArrayValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeArrayValue(item));
  }

  if (isPlainObject(value)) {
    return normalizeJsonValue(value);
  }

  return value;
}

function serializeInsertValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeArrayValue(item));
  }

  if (isPlainObject(value)) {
    return JSON.stringify(normalizeJsonValue(value));
  }

  return value;
}

function serializeInsertRow(row: Record<string, unknown>): QueryResultRow {
  const serialized: QueryResultRow = {};
  for (const [key, value] of Object.entries(row)) {
    serialized[key] = serializeInsertValue(value);
  }
  return serialized;
}

async function loadClickHouseCreateClient(): Promise<ClickHouseCreateClient> {
  try {
    const module = (await import('@clickhouse/client')) as {
      createClient?: ClickHouseCreateClient;
    };

    if (!module.createClient) {
      throw new Error('createClient export is missing');
    }

    return module.createClient;
  } catch (error) {
    throw new Error(
      `Unable to load @clickhouse/client. Install it or provide clickhouse.createClient in the sink config. ${String(error)}`,
    );
  }
}

export class ClickHouseSink implements Sink {
  private readonly cfg: ClickHouseSinkConfig;
  private readonly chCfg: ClickHouseConfig;
  private readonly batchSizes: BatchSizes = { ...DEFAULT_BATCH_SIZES };
  private readonly tables: Record<FlushBufferName, string>;
  private readonly buffers: BufferState = {
    blocks: [],
    txs: [],
    msgs: [],
    events: [],
    attrs: [],
    transfers: [],
    stakeDeleg: [],
    stakeDistr: [],
    wasmExec: [],
    wasmEvents: [],
    govDeposits: [],
    govVotes: [],
    govProposals: [],
  };

  private client: ClickHouseClientLike | null = null;
  private closed = false;

  constructor(cfg: SinkConfig) {
    this.cfg = cfg as ClickHouseSinkConfig;
    this.chCfg = this.cfg.clickhouse ?? this.cfg.ch ?? {};
    this.tables = {
      ...DEFAULT_TABLES,
      ...(this.chCfg.tables ?? {}),
      ...(cfg.table ? { blocks: cfg.table } : {}),
    };

    if (cfg.batchSizes) {
      if (cfg.batchSizes.blocks) this.batchSizes.blocks = cfg.batchSizes.blocks;
      if (cfg.batchSizes.txs) this.batchSizes.txs = cfg.batchSizes.txs;
      if (cfg.batchSizes.msgs) this.batchSizes.msgs = cfg.batchSizes.msgs;
      if (cfg.batchSizes.events) this.batchSizes.events = cfg.batchSizes.events;
      if (cfg.batchSizes.attrs) this.batchSizes.attrs = cfg.batchSizes.attrs;
      if (cfg.batchSizes.transfers) this.batchSizes.transfers = cfg.batchSizes.transfers;
      if (cfg.batchSizes.stakeDeleg) this.batchSizes.stakeDeleg = cfg.batchSizes.stakeDeleg;
      if (cfg.batchSizes.stakeDistr) this.batchSizes.stakeDistr = cfg.batchSizes.stakeDistr;
      if (cfg.batchSizes.wasmExec) this.batchSizes.wasmExec = cfg.batchSizes.wasmExec;
      if (cfg.batchSizes.wasmEvents) this.batchSizes.wasmEvents = cfg.batchSizes.wasmEvents;
      if (cfg.batchSizes.govDeposits) this.batchSizes.govDeposits = cfg.batchSizes.govDeposits;
      if (cfg.batchSizes.govVotes) this.batchSizes.govVotes = cfg.batchSizes.govVotes;
      if (cfg.batchSizes.govProposals) this.batchSizes.govProposals = cfg.batchSizes.govProposals;
    }
  }

  async init(): Promise<void> {
    await this.ensureClient();
  }

  async write(line: any): Promise<void> {
    const blockLine = this.parseLine(line);
    if (!blockLine) {
      return;
    }

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

    this.buffers.blocks.push(blockRow);
    this.buffers.txs.push(...txRows);
    this.buffers.msgs.push(...msgRows);
    this.buffers.events.push(...evRows);
    this.buffers.attrs.push(...attrRows);
    this.buffers.transfers.push(...transfersRows);
    this.buffers.stakeDeleg.push(...stakeDelegRows);
    this.buffers.stakeDistr.push(...stakeDistrRows);
    this.buffers.wasmExec.push(...wasmExecRows);
    this.buffers.wasmEvents.push(...wasmEventsRows);
    this.buffers.govDeposits.push(...govDepositsRows);
    this.buffers.govVotes.push(...govVotesRows);
    this.buffers.govProposals.push(...govProposalsRows);

    const triggeredBy = getTriggeredFlushBuffers(this.getCounts(), this.batchSizes);
    if (triggeredBy.length > 0) {
      await this.flushAll();
    }
  }

  async flush(): Promise<void> {
    await this.flushAll();
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    try {
      await this.flush();
    } finally {
      this.closed = true;
      if (!this.client) {
        return;
      }

      const client = this.client;
      this.client = null;
      await client.close();
    }
  }

  async getMaxHeight(): Promise<number | null> {
    const client = await this.ensureClient();
    const result = await client.query({
      query: `SELECT max(height) AS max_height FROM ${this.tables.blocks}`,
      format: 'JSONEachRow',
    });
    const rows = await result.json<QueryResultRow[]>();
    const maxHeight = rows[0]?.max_height;
    if (maxHeight === null || maxHeight === undefined) {
      return null;
    }

    const parsed = Number(maxHeight);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private parseLine(line: unknown): BlockLine | null {
    let parsed: BlockLine;
    if (typeof line === 'string') {
      try {
        parsed = JSON.parse(line);
      } catch {
        return null;
      }
    } else {
      parsed = line as BlockLine;
    }

    if (parsed?.error) {
      return null;
    }

    return parsed;
  }

  private async ensureClient(): Promise<ClickHouseClientLike> {
    if (this.closed) {
      throw new Error('ClickHouseSink is closed');
    }

    if (this.client) {
      return this.client;
    }

    const client = this.chCfg.client ?? (await this.createClient());
    const pingResult = await client.ping();
    if (pingResult === false) {
      throw new Error('ClickHouse ping failed');
    }
    if (
      pingResult &&
      typeof pingResult === 'object' &&
      'success' in pingResult &&
      (pingResult as { success?: boolean }).success === false
    ) {
      throw new Error('ClickHouse ping failed');
    }

    this.client = client;
    return client;
  }

  private async createClient(): Promise<ClickHouseClientLike> {
    const createClient = this.chCfg.createClient ?? (await loadClickHouseCreateClient());
    const endpoint = this.chCfg.url ?? this.chCfg.host ?? this.cfg.connectionString;
    const clientOptions: Record<string, unknown> = {};

    if (endpoint) {
      clientOptions.url = endpoint;
      clientOptions.host = endpoint;
    }
    if (this.chCfg.username) {
      clientOptions.username = this.chCfg.username;
    }
    if (this.chCfg.password) {
      clientOptions.password = this.chCfg.password;
    }
    if (this.chCfg.database) {
      clientOptions.database = this.chCfg.database;
    }
    clientOptions.clickhouse_settings = DEFAULT_CLIENT_SETTINGS;

    return createClient(clientOptions);
  }

  private getCounts(): FlushBufferCounts {
    return {
      blocks: this.buffers.blocks.length,
      txs: this.buffers.txs.length,
      msgs: this.buffers.msgs.length,
      events: this.buffers.events.length,
      attrs: this.buffers.attrs.length,
      transfers: this.buffers.transfers.length,
      stakeDeleg: this.buffers.stakeDeleg.length,
      stakeDistr: this.buffers.stakeDistr.length,
      wasmExec: this.buffers.wasmExec.length,
      wasmEvents: this.buffers.wasmEvents.length,
      govDeposits: this.buffers.govDeposits.length,
      govVotes: this.buffers.govVotes.length,
      govProposals: this.buffers.govProposals.length,
    };
  }

  private async flushAll(): Promise<void> {
    if (!FLUSH_ORDER.some((bufferName) => this.buffers[bufferName].length > 0)) {
      return;
    }

    const client = await this.ensureClient();
    const snapshots: Array<{ bufferName: FlushBufferName; rows: any[] }> = [];

    for (const bufferName of FLUSH_ORDER) {
      const bufferedRows = this.buffers[bufferName];
      if (bufferedRows.length === 0) {
        continue;
      }

      const snapshot = bufferedRows.slice();
      snapshots.push({ bufferName, rows: snapshot });
      const shapedRows = this.shapeRowsForInsert(bufferName, snapshot);
      if (shapedRows.length > 0) {
        await client.insert({
          table: this.tables[bufferName],
          values: shapedRows.map((row) => serializeInsertRow(row)),
          format: 'JSONEachRow',
        });
      }
    }

    for (const { bufferName, rows } of snapshots) {
      this.buffers[bufferName].splice(0, rows.length);
    }
  }

  private shapeRowsForInsert(bufferName: FlushBufferName, rows: any[]): QueryResultRow[] {
    if (bufferName === 'stakeDeleg') {
      return rows.filter((row) => row && row.delegator_address && row.denom && row.amount && row.event_type);
    }

    if (bufferName === 'govProposals') {
      return rows.map((row) => ({
        ...row,
        status: row?.status ?? 'deposit_period',
      }));
    }

    return rows;
  }

  private extractRows(blockLine: BlockLine): ExtractedRows {
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

      const msgs = pickMessages(tx);
      if (!signers || signers.length === 0) {
        const derived = collectSignersFromMessages(msgs);
        if (derived) {
          signers = derived;
        }
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
            gas_used,
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
            let delegator = findAttr(attrsPairs, 'delegator');
            let validator = findAttr(attrsPairs, 'validator');
            let srcVal = findAttr(attrsPairs, 'source_validator');
            let dstVal = findAttr(attrsPairs, 'destination_validator');

            const amountStr = findAttr(attrsPairs, 'amount') ?? findAttr(attrsPairs, 'completion_amount');
            let coin = parseCoin(amountStr ?? '');

            if ((!delegator || !srcVal || !dstVal || !coin) && msg_index >= 0 && msg_index < msgs.length) {
              const mm = msgs[msg_index] ?? {};
              if (!delegator && typeof mm.delegator_address === 'string') {
                delegator = mm.delegator_address;
              }
              const mType = mm?.['@type'] ?? mm?.type_url ?? '';
              if (mType.includes('MsgBeginRedelegate')) {
                if (!srcVal && typeof mm.source_validator_address === 'string') {
                  srcVal = mm.source_validator_address;
                }
                if (!dstVal && typeof mm.destination_validator_address === 'string') {
                  dstVal = mm.destination_validator_address;
                }
              } else if (mType.includes('MsgDelegate') || mType.includes('MsgUndelegate')) {
                if (!validator && typeof mm.validator_address === 'string') {
                  validator = mm.validator_address;
                }
                if (!dstVal) {
                  dstVal = validator ?? dstVal ?? null;
                }
              }
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

    const gov = blockLine?.gov ?? {};
    if (Array.isArray(gov.deposits)) {
      for (const row of gov.deposits) {
        govDepositsRows.push(row);
      }
    }
    if (Array.isArray(gov.votes)) {
      for (const row of gov.votes) {
        govVotesRows.push(row);
      }
    }
    if (Array.isArray(gov.proposals)) {
      for (const row of gov.proposals) {
        govProposalsRows.push(row);
      }
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
}

export { ClickHouseSink as ClickhouseSink };

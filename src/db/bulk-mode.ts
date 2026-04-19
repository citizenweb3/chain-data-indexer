// src/db/bulk-mode.ts

/**
 * Bulk-mode helpers for high-throughput backfill ingestion.
 *
 * - bulkModeOn()  — drops secondary indexes and disables autovacuum on hot tables
 * - bulkModeOff() — recreates indexes, re-enables autovacuum, runs VACUUM ANALYZE
 * - recoverDerived() — fills derived tables that lag behind core.events
 */

import type { Pool } from 'pg';
import { getLogger } from '../utils/logger.ts';
import { findAttr, attrsToPairs, parseCoin } from '../sink/pg/parsing.ts';
import { flushTransfers } from '../sink/pg/flushers/transfers.ts';
import { flushStakeDeleg } from '../sink/pg/flushers/stake_deleg.ts';
import { flushStakeDistr } from '../sink/pg/flushers/stake_distr.ts';
import { flushWasmEvents } from '../sink/pg/flushers/wasm_events.ts';

const log = getLogger('db/bulk-mode');

// ---------------------------------------------------------------------------
// Index definitions (33 total) — symmetric drop/create pairs
// ---------------------------------------------------------------------------

const INDEXES: Array<{ name: string; drop: string; create: string }> = [
  // core.blocks (3)
  {
    name: 'idx_blocks_time',
    drop: 'DROP INDEX IF EXISTS core.idx_blocks_time',
    create: 'CREATE INDEX IF NOT EXISTS idx_blocks_time ON core.blocks USING BTREE (time)',
  },
  {
    name: 'idx_blocks_proposer',
    drop: 'DROP INDEX IF EXISTS core.idx_blocks_proposer',
    create: 'CREATE INDEX IF NOT EXISTS idx_blocks_proposer ON core.blocks (proposer_address)',
  },
  {
    name: 'idx_blocks_brin_height',
    drop: 'DROP INDEX IF EXISTS core.idx_blocks_brin_height',
    create: 'CREATE INDEX IF NOT EXISTS idx_blocks_brin_height ON core.blocks USING BRIN (height)',
  },

  // core.transactions (5) — uq_txs_height_pos intentionally NOT dropped
  {
    name: 'idx_txs_code',
    drop: 'DROP INDEX IF EXISTS core.idx_txs_code',
    create: 'CREATE INDEX IF NOT EXISTS idx_txs_code ON core.transactions (code)',
  },
  {
    name: 'idx_txs_signers_gin',
    drop: 'DROP INDEX IF EXISTS core.idx_txs_signers_gin',
    create: 'CREATE INDEX IF NOT EXISTS idx_txs_signers_gin ON core.transactions USING GIN (signers)',
  },
  {
    name: 'idx_txs_time',
    drop: 'DROP INDEX IF EXISTS core.idx_txs_time',
    create: 'CREATE INDEX IF NOT EXISTS idx_txs_time ON core.transactions (time DESC)',
  },
  {
    name: 'idx_txs_success',
    drop: 'DROP INDEX IF EXISTS core.idx_txs_success',
    create: 'CREATE INDEX IF NOT EXISTS idx_txs_success ON core.transactions (height DESC, tx_index) WHERE code = 0',
  },
  {
    name: 'idx_txs_hash',
    drop: 'DROP INDEX IF EXISTS core.idx_txs_hash',
    create: 'CREATE INDEX IF NOT EXISTS idx_txs_hash ON core.transactions (tx_hash)',
  },

  // core.messages (4)
  {
    name: 'idx_msgs_height_type',
    drop: 'DROP INDEX IF EXISTS core.idx_msgs_height_type',
    create: 'CREATE INDEX IF NOT EXISTS idx_msgs_height_type ON core.messages (height DESC, type_url)',
  },
  {
    name: 'idx_msgs_signer',
    drop: 'DROP INDEX IF EXISTS core.idx_msgs_signer',
    create: 'CREATE INDEX IF NOT EXISTS idx_msgs_signer ON core.messages (signer, height DESC)',
  },
  {
    name: 'idx_msgs_value_path',
    drop: 'DROP INDEX IF EXISTS core.idx_msgs_value_path CASCADE',
    create: 'CREATE INDEX IF NOT EXISTS idx_msgs_value_path ON core.messages USING GIN (value jsonb_path_ops)',
  },
  {
    name: 'idx_msgs_txhash_msg',
    drop: 'DROP INDEX IF EXISTS core.idx_msgs_txhash_msg',
    create: 'CREATE INDEX IF NOT EXISTS idx_msgs_txhash_msg ON core.messages (tx_hash, msg_index)',
  },

  // core.events (1)
  {
    name: 'idx_events_type',
    drop: 'DROP INDEX IF EXISTS core.idx_events_type',
    create: 'CREATE INDEX IF NOT EXISTS idx_events_type ON core.events (event_type)',
  },

  // bank.transfers (4)
  {
    name: 'idx_transfers_from',
    drop: 'DROP INDEX IF EXISTS bank.idx_transfers_from',
    create: 'CREATE INDEX IF NOT EXISTS idx_transfers_from ON bank.transfers (from_addr, height DESC)',
  },
  {
    name: 'idx_transfers_to',
    drop: 'DROP INDEX IF EXISTS bank.idx_transfers_to',
    create: 'CREATE INDEX IF NOT EXISTS idx_transfers_to ON bank.transfers (to_addr, height DESC)',
  },
  {
    name: 'idx_transfers_denom',
    drop: 'DROP INDEX IF EXISTS bank.idx_transfers_denom',
    create: 'CREATE INDEX IF NOT EXISTS idx_transfers_denom ON bank.transfers (denom)',
  },
  {
    name: 'idx_transfers_brin_height',
    drop: 'DROP INDEX IF EXISTS bank.idx_transfers_brin_height',
    create: 'CREATE INDEX IF NOT EXISTS idx_transfers_brin_height ON bank.transfers USING BRIN (height)',
  },

  // stake.delegation_events (3)
  {
    name: 'idx_del_ev_delegator',
    drop: 'DROP INDEX IF EXISTS stake.idx_del_ev_delegator',
    create:
      'CREATE INDEX IF NOT EXISTS idx_del_ev_delegator ON stake.delegation_events (delegator_address, height DESC)',
  },
  {
    name: 'idx_del_ev_valdst',
    drop: 'DROP INDEX IF EXISTS stake.idx_del_ev_valdst',
    create: 'CREATE INDEX IF NOT EXISTS idx_del_ev_valdst ON stake.delegation_events (validator_dst, height DESC)',
  },
  {
    name: 'idx_del_ev_valsrc',
    drop: 'DROP INDEX IF EXISTS stake.idx_del_ev_valsrc',
    create: 'CREATE INDEX IF NOT EXISTS idx_del_ev_valsrc ON stake.delegation_events (validator_src, height DESC)',
  },

  // stake.distribution_events (2)
  {
    name: 'idx_dist_ev_validator',
    drop: 'DROP INDEX IF EXISTS stake.idx_dist_ev_validator',
    create:
      'CREATE INDEX IF NOT EXISTS idx_dist_ev_validator ON stake.distribution_events (validator_address, height DESC)',
  },
  {
    name: 'idx_dist_ev_delegator',
    drop: 'DROP INDEX IF EXISTS stake.idx_dist_ev_delegator',
    create:
      'CREATE INDEX IF NOT EXISTS idx_dist_ev_delegator ON stake.distribution_events (delegator_address, height DESC)',
  },

  // gov.proposals (1)
  {
    name: 'idx_gov_status',
    drop: 'DROP INDEX IF EXISTS gov.idx_gov_status',
    create: 'CREATE INDEX IF NOT EXISTS idx_gov_status ON gov.proposals (status)',
  },

  // gov.deposits (1)
  {
    name: 'idx_gov_dep_depositor',
    drop: 'DROP INDEX IF EXISTS gov.idx_gov_dep_depositor',
    create: 'CREATE INDEX IF NOT EXISTS idx_gov_dep_depositor ON gov.deposits (depositor, height DESC)',
  },

  // gov.votes (2)
  {
    name: 'idx_gov_votes_voter',
    drop: 'DROP INDEX IF EXISTS gov.idx_gov_votes_voter',
    create: 'CREATE INDEX IF NOT EXISTS idx_gov_votes_voter ON gov.votes (voter, height DESC)',
  },
  {
    name: 'idx_gov_votes_prop',
    drop: 'DROP INDEX IF EXISTS gov.idx_gov_votes_prop',
    create: 'CREATE INDEX IF NOT EXISTS idx_gov_votes_prop ON gov.votes (proposal_id, option)',
  },

  // wasm.executions (4)
  {
    name: 'idx_wasm_exec_contract',
    drop: 'DROP INDEX IF EXISTS wasm.idx_wasm_exec_contract',
    create: 'CREATE INDEX IF NOT EXISTS idx_wasm_exec_contract ON wasm.executions (contract, height DESC)',
  },
  {
    name: 'idx_wasm_exec_msg_gin',
    drop: 'DROP INDEX IF EXISTS wasm.idx_wasm_exec_msg_gin',
    create: 'CREATE INDEX IF NOT EXISTS idx_wasm_exec_msg_gin ON wasm.executions USING GIN (msg jsonb_path_ops)',
  },
  {
    name: 'idx_wasm_exec_success',
    drop: 'DROP INDEX IF EXISTS wasm.idx_wasm_exec_success',
    create: 'CREATE INDEX IF NOT EXISTS idx_wasm_exec_success ON wasm.executions (success)',
  },
  {
    name: 'idx_wasm_exec_tx_msg',
    drop: 'DROP INDEX IF EXISTS wasm.idx_wasm_exec_tx_msg',
    create: 'CREATE INDEX IF NOT EXISTS idx_wasm_exec_tx_msg ON wasm.executions (tx_hash, msg_index)',
  },

  // wasm.events (3)
  {
    name: 'idx_wasm_events_contract',
    drop: 'DROP INDEX IF EXISTS wasm.idx_wasm_events_contract',
    create: 'CREATE INDEX IF NOT EXISTS idx_wasm_events_contract ON wasm.events (contract, height DESC)',
  },
  {
    name: 'idx_wasm_events_type',
    drop: 'DROP INDEX IF EXISTS wasm.idx_wasm_events_type',
    create: 'CREATE INDEX IF NOT EXISTS idx_wasm_events_type ON wasm.events (event_type)',
  },
  {
    name: 'idx_wasm_events_tx_msg',
    drop: 'DROP INDEX IF EXISTS wasm.idx_wasm_events_tx_msg',
    create: 'CREATE INDEX IF NOT EXISTS idx_wasm_events_tx_msg ON wasm.events (tx_hash, msg_index)',
  },
];

// ---------------------------------------------------------------------------
// Tables where autovacuum is toggled during bulk ingest
// ---------------------------------------------------------------------------

const AUTOVACUUM_PARENT_TABLES = [
  'core.transactions',
  'core.events',
  'core.messages',
  'bank.transfers',
  'stake.delegation_events',
  'stake.distribution_events',
  'wasm.executions',
  'wasm.events',
];

/**
 * Returns all child partition table names for the given partitioned parent tables.
 * PostgreSQL does not allow SET (autovacuum_enabled) on partitioned parents,
 * so we must apply it to each child partition individually.
 */
async function getPartitionChildren(pool: Pool, parents: string[]): Promise<string[]> {
  const conditions = parents
    .map((p) => {
      const [schema, table] = p.split('.');
      return `(n.nspname = '${schema}' AND c.relname = '${table}')`;
    })
    .join(' OR ');

  const { rows } = await pool.query(`
    SELECT pn.nspname || '.' || pc.relname AS child
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhparent
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_class pc ON pc.oid = i.inhrelid
    JOIN pg_namespace pn ON pn.oid = pc.relnamespace
    WHERE ${conditions}
    ORDER BY child
  `);

  return rows.map((r: any) => r.child as string);
}

// ---------------------------------------------------------------------------
// bulkModeOn — prepare database for fast backfill
// ---------------------------------------------------------------------------

/**
 * Drops 33 secondary indexes and disables autovacuum on 8 hot tables to
 * maximise INSERT throughput during bulk backfill.
 *
 * Fully idempotent — safe to call multiple times.
 */
export async function bulkModeOn(pool: Pool): Promise<void> {
  const t0 = Date.now();
  let dropped = 0;

  for (const idx of INDEXES) {
    log.info('dropping index %s', idx.name);
    await pool.query(idx.drop);
    dropped++;
  }

  const children = await getPartitionChildren(pool, AUTOVACUUM_PARENT_TABLES);
  for (const child of children) {
    await pool.query(`ALTER TABLE ${child} SET (autovacuum_enabled = false)`);
  }
  log.info('disabled autovacuum on %d partitions', children.length);

  log.info('bulk mode ON: dropped %d indexes, disabled autovacuum on %d partitions (%d ms)', dropped, children.length, Date.now() - t0);
}

// ---------------------------------------------------------------------------
// bulkModeOff — restore indexes and maintenance after backfill
// ---------------------------------------------------------------------------

/**
 * Recreates all 33 secondary indexes, re-enables autovacuum, and runs
 * VACUUM ANALYZE on the hot tables.
 *
 * Logs elapsed time per index and total wall-clock time.
 */
export async function bulkModeOff(pool: Pool): Promise<void> {
  const t0 = Date.now();
  let created = 0;

  for (const idx of INDEXES) {
    const idxT0 = Date.now();
    log.info('creating index %s...', idx.name);
    await pool.query(idx.create);
    created++;
    log.info('created index %s (%d ms)', idx.name, Date.now() - idxT0);
  }

  const children = await getPartitionChildren(pool, AUTOVACUUM_PARENT_TABLES);
  for (const child of children) {
    await pool.query(`ALTER TABLE ${child} SET (autovacuum_enabled = true)`);
  }
  log.info('re-enabled autovacuum on %d partitions', children.length);

  for (const parent of AUTOVACUUM_PARENT_TABLES) {
    const vacT0 = Date.now();
    log.info('VACUUM ANALYZE %s...', parent);
    await pool.query(`VACUUM ANALYZE ${parent}`);
    log.info('VACUUM ANALYZE %s done (%d ms)', parent, Date.now() - vacT0);
  }

  log.info('bulk mode OFF: created %d indexes, vacuumed %d tables (%d ms)', created, AUTOVACUUM_PARENT_TABLES.length, Date.now() - t0);
}

// ---------------------------------------------------------------------------
// recoverDerived — fill derived tables that lag behind core.events
// ---------------------------------------------------------------------------

/** Batch size for reading events during gap recovery. */
const RECOVER_BATCH = 10_000;

/**
 * Checks if derived tables (transfers, stake, wasm events) lag behind
 * core.events and fills the gap by re-extracting from stored event rows.
 *
 * Tables that cannot be recovered from events alone (wasm.executions,
 * gov.deposits, gov.votes) emit a warning instead.
 */
export async function recoverDerived(pool: Pool): Promise<void> {
  const t0 = Date.now();

  // Step 1: query current heights for all relevant tables
  const heightsResult = await pool.query(`
    SELECT
      (SELECT COALESCE(MAX(height), 0) FROM core.events) AS events_height,
      (SELECT COALESCE(MAX(height), 0) FROM bank.transfers) AS transfers_height,
      (SELECT COALESCE(MAX(height), 0) FROM stake.delegation_events) AS stake_deleg_height,
      (SELECT COALESCE(MAX(height), 0) FROM stake.distribution_events) AS stake_distr_height,
      (SELECT COALESCE(MAX(height), 0) FROM wasm.executions) AS wasm_exec_height,
      (SELECT COALESCE(MAX(height), 0) FROM wasm.events) AS wasm_events_height,
      (SELECT COALESCE(MAX(height), 0) FROM gov.deposits) AS gov_deposits_height,
      (SELECT COALESCE(MAX(height), 0) FROM gov.votes) AS gov_votes_height
  `);

  const row = heightsResult.rows[0];
  const eventsH = Number(row.events_height);
  const transfersH = Number(row.transfers_height);
  const stakeDelegH = Number(row.stake_deleg_height);
  const stakeDistrH = Number(row.stake_distr_height);
  const wasmExecH = Number(row.wasm_exec_height);
  const wasmEventsH = Number(row.wasm_events_height);
  const govDepositsH = Number(row.gov_deposits_height);
  const govVotesH = Number(row.gov_votes_height);

  log.info('height check — events: %d, transfers: %d, stakeDeleg: %d, stakeDistr: %d, wasmExec: %d, wasmEvents: %d, govDeposits: %d, govVotes: %d', eventsH, transfersH, stakeDelegH, stakeDistrH, wasmExecH, wasmEventsH, govDepositsH, govVotesH);

  // Step 2: find minimum derived height (only for tables that have data)
  // Tables with height=0 were never populated (e.g. wasm on Cosmos Hub) — skip them
  const recoverableHeights = [transfersH, stakeDelegH, stakeDistrH, wasmEventsH].filter((h) => h > 0);

  if (recoverableHeights.length === 0) {
    log.info('no recoverable derived tables have data — skipping recovery');
    return;
  }

  const minDerivedH = Math.min(...recoverableHeights);

  // Step 3: warn about tables that cannot be recovered from events (only if they have data)
  if (wasmExecH > 0 && wasmExecH < eventsH) {
    log.warn('cannot recover wasm.executions from events — requires re-indexing the gap range [%d, %d]', wasmExecH + 1, eventsH);
  }
  if (govDepositsH > 0 && govDepositsH < eventsH) {
    log.warn('cannot recover gov.deposits from events — requires re-indexing the gap range [%d, %d]', govDepositsH + 1, eventsH);
  }
  if (govVotesH > 0 && govVotesH < eventsH) {
    log.warn('cannot recover gov.votes from events — requires re-indexing the gap range [%d, %d]', govVotesH + 1, eventsH);
  }

  // Step 4: if event-recoverable tables are up to date, return
  if (minDerivedH >= eventsH) {
    log.info('derived tables up to date');
    return;
  }

  log.info('recovering derived tables from height %d to %d', minDerivedH + 1, eventsH);

  // Step 5: re-extract from events in batches
  let cursor = minDerivedH;

  while (cursor < eventsH) {
    const batchEnd = Math.min(cursor + RECOVER_BATCH, eventsH);

    const eventsResult = await pool.query(
      `SELECT height, tx_hash, msg_index, event_index, event_type, attributes
       FROM core.events
       WHERE height > $1 AND height <= $2
       ORDER BY height, tx_hash, msg_index, event_index`,
      [cursor, batchEnd],
    );

    const transfersRows: any[] = [];
    const stakeDelegRows: any[] = [];
    const stakeDistrRows: any[] = [];
    const wasmEventsRows: any[] = [];

    for (const ev of eventsResult.rows) {
      const height = Number(ev.height);
      const txHash = String(ev.tx_hash);
      const msgIndex = Number(ev.msg_index);
      const eventType = String(ev.event_type);
      const rawAttrs = ev.attributes;
      const pairs = attrsToPairs(rawAttrs);

      // Transfer extraction
      if (eventType === 'transfer' && height > transfersH) {
        const sender = findAttr(pairs, 'sender');
        const recipient = findAttr(pairs, 'recipient');
        const amountStr = findAttr(pairs, 'amount');
        const coin = parseCoin(amountStr);
        if (sender && recipient && coin) {
          transfersRows.push({
            tx_hash: txHash,
            msg_index: msgIndex,
            from_addr: sender,
            to_addr: recipient,
            denom: coin.denom,
            amount: coin.amount,
            height,
          });
        }
      }

      // Stake delegation extraction
      if (
        (eventType === 'delegate' ||
          eventType === 'redelegate' ||
          eventType === 'unbond' ||
          eventType === 'complete_unbonding') &&
        height > stakeDelegH
      ) {
        const delegator = findAttr(pairs, 'delegator');
        const validator = findAttr(pairs, 'validator');
        const srcVal = findAttr(pairs, 'source_validator');
        const dstVal = findAttr(pairs, 'destination_validator');
        const amountStr = findAttr(pairs, 'amount') ?? findAttr(pairs, 'completion_amount');
        const coin = parseCoin(amountStr ?? '');
        const completionTime = findAttr(pairs, 'completion_time');

        stakeDelegRows.push({
          height,
          tx_hash: txHash,
          msg_index: msgIndex,
          event_type: eventType,
          delegator_address: delegator ?? null,
          validator_src: srcVal ?? null,
          validator_dst: dstVal ?? validator ?? null,
          denom: coin?.denom ?? null,
          amount: coin?.amount ?? null,
          completion_time: completionTime ? new Date(completionTime) : null,
        });
      }

      // Stake distribution extraction
      if (
        (eventType === 'withdraw_rewards' ||
          eventType === 'withdraw_commission' ||
          eventType === 'set_withdraw_address') &&
        height > stakeDistrH
      ) {
        const delegator = findAttr(pairs, 'delegator');
        const validator = findAttr(pairs, 'validator') ?? findAttr(pairs, 'validator_address');
        const withdrawAddr = findAttr(pairs, 'withdraw_address') ?? findAttr(pairs, 'withdraw_address_old');
        const amountStr = findAttr(pairs, 'amount');
        const coin = parseCoin(amountStr ?? '');

        stakeDistrRows.push({
          height,
          tx_hash: txHash,
          msg_index: msgIndex,
          event_type: eventType,
          delegator_address: delegator ?? null,
          validator_address: validator ?? null,
          denom: coin?.denom ?? null,
          amount: coin?.amount ?? null,
          withdraw_address: withdrawAddr ?? null,
        });
      }

      // Wasm events extraction
      if (eventType === 'wasm' && height > wasmEventsH) {
        const contract = findAttr(pairs, '_contract_address') ?? findAttr(pairs, 'contract_address');
        if (contract) {
          wasmEventsRows.push({
            contract,
            height,
            tx_hash: txHash,
            msg_index: msgIndex,
            event_type: eventType,
            attributes: pairs,
          });
        }
      }
    }

    // Flush accumulated rows using existing flushers within a transaction
    if (transfersRows.length || stakeDelegRows.length || stakeDistrRows.length || wasmEventsRows.length) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await flushTransfers(client, transfersRows);
        await flushStakeDeleg(client, stakeDelegRows);
        await flushStakeDistr(client, stakeDistrRows);
        await flushWasmEvents(client, wasmEventsRows);
        await client.query('COMMIT');

        log.info(
          'recovered batch [%d, %d]: transfers=%d, stakeDeleg=%d, stakeDistr=%d, wasmEvents=%d',
          cursor + 1,
          batchEnd,
          transfersRows.length,
          stakeDelegRows.length,
          stakeDistrRows.length,
          wasmEventsRows.length,
        );
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    cursor = batchEnd;
  }

  log.info('recoverDerived complete (%d ms)', Date.now() - t0);
}

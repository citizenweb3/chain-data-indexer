import { db } from '@/db/indexer-db';
import { TEXT_ARRAY_OID } from '@/db/postgres-types';

export type StakingDeltaEventType =
  | 'delegate'
  | 'redelegate'
  | 'unbond'
  | 'create_validator'
  | 'cancel_unbonding_delegation';

export interface StakingDeltaRow {
  height: bigint;
  tx_index: number;
  msg_index: number;
  tx_hash: string;
  time: Date;
  event_type: StakingDeltaEventType;
  validator_src: string | null;
  validator_dst: string | null;
  denom: string;
  amount: string;
  sign: 1 | -1 | 0;
  source: 'event' | 'message';
}

export interface StakingDeltaStatsRow {
  total: bigint;
  skipped_ambiguous_msgexec: bigint;
}

export interface StakingDeltaQueryParams {
  delegator: string;
  valoper: string;
  limit: number;
  beforeHeight?: bigint;
  beforeIndex?: number;
  beforeMsgIndex?: number;
}

const AUTHZ_EXEC_TYPES = ['/cosmos.authz.v1beta1.MsgExec', '/cosmos.authz.v1.MsgExec'];
const CREATE_VALIDATOR_TYPES = ['/cosmos.staking.v1beta1.MsgCreateValidator', '/cosmos.staking.v1.MsgCreateValidator'];
const CANCEL_UNBONDING_TYPES = [
  '/cosmos.staking.v1beta1.MsgCancelUnbondingDelegation',
  '/cosmos.staking.v1.MsgCancelUnbondingDelegation',
];
const RELEVANT_INNER_TYPES = [
  '/cosmos.staking.v1beta1.MsgDelegate',
  '/cosmos.staking.v1.MsgDelegate',
  '/cosmos.staking.v1beta1.MsgUndelegate',
  '/cosmos.staking.v1.MsgUndelegate',
  '/cosmos.staking.v1beta1.MsgBeginRedelegate',
  '/cosmos.staking.v1.MsgBeginRedelegate',
  ...CREATE_VALIDATOR_TYPES,
  ...CANCEL_UNBONDING_TYPES,
];

const buildCandidateRelations = (delegator: string, valoper: string) => {
  const delegatorProbe = { msgs: [{ delegator_address: delegator }] };
  const valoperProbe = { msgs: [{ validator_address: valoper }] };

  return db`
    direct_signer_transactions AS MATERIALIZED (
      SELECT height, tx_hash, tx_index, time
      FROM core.transactions
      WHERE code = 0
        AND signers && ${db.array([delegator, valoper], TEXT_ARRAY_OID)}
    ),
    authz_messages AS (
      SELECT m.height, m.tx_hash, m.msg_index, t.tx_index, t.time, m.value
      FROM core.messages m
      JOIN core.transactions t
        ON t.height = m.height AND t.tx_hash = m.tx_hash
      WHERE t.code = 0
        AND m.type_url = ANY(${db.array(AUTHZ_EXEC_TYPES, TEXT_ARRAY_OID)})
        AND jsonb_typeof(m.value->'msgs') = 'array'
        AND (
          m.value @> ${db.json(delegatorProbe)}
          OR m.value @> ${db.json(valoperProbe)}
        )
    ),
    authz_inner AS (
      SELECT
        authz.height,
        authz.tx_hash,
        authz.msg_index,
        authz.tx_index,
        authz.time,
        inner_message.value AS message_value,
        COALESCE(inner_message.value->>'@type', inner_message.value->>'type_url') AS message_type
      FROM authz_messages authz
      CROSS JOIN LATERAL jsonb_array_elements(authz.value->'msgs') AS inner_message(value)
      WHERE COALESCE(inner_message.value->>'@type', inner_message.value->>'type_url') =
        ANY(${db.array(RELEVANT_INNER_TYPES, TEXT_ARRAY_OID)})
        AND (
          inner_message.value->>'delegator_address' = ${delegator}
          OR (
            COALESCE(inner_message.value->>'@type', inner_message.value->>'type_url') =
              ANY(${db.array(CREATE_VALIDATOR_TYPES, TEXT_ARRAY_OID)})
            AND inner_message.value->>'validator_address' = ${valoper}
          )
        )
    ),
    unsafe_msgexec_keys AS (
      SELECT height, tx_hash, msg_index
      FROM authz_inner
      GROUP BY height, tx_hash, msg_index
      HAVING COUNT(*) > 1
    ),
    event_candidates AS (
      SELECT
        delegation.height,
        transaction.tx_index,
        delegation.msg_index,
        delegation.tx_hash,
        transaction.time,
        delegation.event_type,
        delegation.validator_src,
        delegation.validator_dst,
        delegation.denom,
        delegation.amount::text AS amount,
        CASE
          WHEN delegation.event_type = 'unbond' THEN -1
          WHEN delegation.event_type = 'redelegate' THEN 0
          ELSE 1
        END AS sign,
        'event'::text AS source
      FROM stake.delegation_events delegation
      JOIN core.transactions transaction
        ON transaction.height = delegation.height AND transaction.tx_hash = delegation.tx_hash
      WHERE delegation.delegator_address = ${delegator}
        AND delegation.event_type = ANY(${db.array(['delegate', 'redelegate', 'unbond'], TEXT_ARRAY_OID)})
        AND transaction.code = 0
        AND NOT (
          delegation.msg_index = -1
          AND EXISTS (
            SELECT 1
            FROM stake.delegation_events sibling
            WHERE sibling.height = delegation.height
              AND sibling.tx_hash = delegation.tx_hash
              AND sibling.msg_index >= 0
              AND sibling.event_type = delegation.event_type
              AND sibling.validator_src IS NOT DISTINCT FROM delegation.validator_src
              AND sibling.validator_dst IS NOT DISTINCT FROM delegation.validator_dst
              AND sibling.delegator_address IS NOT DISTINCT FROM delegation.delegator_address
              AND sibling.amount IS NOT DISTINCT FROM delegation.amount
              AND sibling.denom IS NOT DISTINCT FROM delegation.denom
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM unsafe_msgexec_keys unsafe
          WHERE unsafe.height = delegation.height
            AND unsafe.tx_hash = delegation.tx_hash
            AND (unsafe.msg_index = delegation.msg_index OR delegation.msg_index = -1)
        )
    ),
    direct_message_candidates AS (
      SELECT message.height, message.tx_hash, message.msg_index, signer_transaction.tx_index,
        signer_transaction.time, message.type_url AS message_type, message.value AS message_value
      FROM direct_signer_transactions signer_transaction
      JOIN LATERAL (
        SELECT candidate.height, candidate.tx_hash, candidate.msg_index,
          candidate.type_url, candidate.value
        FROM core.messages candidate
        WHERE candidate.height = signer_transaction.height
          AND candidate.tx_hash = signer_transaction.tx_hash
          AND candidate.type_url = ANY(${db.array(CREATE_VALIDATOR_TYPES, TEXT_ARRAY_OID)})
          AND (
            candidate.value->>'delegator_address' = ${delegator}
            OR candidate.value->>'validator_address' = ${valoper}
          )
        OFFSET 0
      ) message ON TRUE
      UNION ALL
      SELECT message.height, message.tx_hash, message.msg_index, transaction.tx_index,
        transaction.time, message.type_url AS message_type, message.value AS message_value
      FROM core.messages message
      JOIN core.transactions transaction
        ON transaction.height = message.height AND transaction.tx_hash = message.tx_hash
      WHERE transaction.code = 0
        AND message.signer = ${delegator}
        AND message.type_url = ANY(${db.array(CANCEL_UNBONDING_TYPES, TEXT_ARRAY_OID)})
        AND message.value->>'delegator_address' = ${delegator}
    ),
    message_candidates AS (
      SELECT height, tx_hash, msg_index, tx_index, time, message_type, message_value
      FROM direct_message_candidates
      UNION ALL
      SELECT inner_message.height, inner_message.tx_hash, inner_message.msg_index,
        inner_message.tx_index, inner_message.time, inner_message.message_type,
        inner_message.message_value
      FROM authz_inner inner_message
      WHERE inner_message.message_type =
        ANY(${db.array([...CREATE_VALIDATOR_TYPES, ...CANCEL_UNBONDING_TYPES], TEXT_ARRAY_OID)})
        AND NOT EXISTS (
          SELECT 1
          FROM unsafe_msgexec_keys unsafe
          WHERE unsafe.height = inner_message.height
            AND unsafe.tx_hash = inner_message.tx_hash
            AND unsafe.msg_index = inner_message.msg_index
        )
    ),
    message_supplements AS (
      SELECT
        message.height,
        message.tx_index,
        message.msg_index,
        message.tx_hash,
        message.time,
        CASE
          WHEN message.message_type = ANY(${db.array(CREATE_VALIDATOR_TYPES, TEXT_ARRAY_OID)})
            THEN 'create_validator'
          ELSE 'cancel_unbonding_delegation'
        END AS event_type,
        NULL::text AS validator_src,
        message.message_value->>'validator_address' AS validator_dst,
        CASE
          WHEN message.message_type = ANY(${db.array(CREATE_VALIDATOR_TYPES, TEXT_ARRAY_OID)})
            THEN message.message_value->'value'->>'denom'
          ELSE message.message_value->'amount'->>'denom'
        END AS denom,
        CASE
          WHEN message.message_type = ANY(${db.array(CREATE_VALIDATOR_TYPES, TEXT_ARRAY_OID)})
            THEN message.message_value->'value'->>'amount'
          ELSE message.message_value->'amount'->>'amount'
        END AS amount,
        1 AS sign,
        'message'::text AS source
      FROM message_candidates message
    ),
    valid_message_supplements AS (
      SELECT *
      FROM message_supplements
      WHERE validator_dst IS NOT NULL
        AND denom IS NOT NULL
        AND denom <> ''
        AND amount ~ '^\\d+$'
    ),
    all_candidates AS (
      SELECT * FROM event_candidates
      UNION ALL
      SELECT * FROM valid_message_supplements
    )
  `;
};

export const queryStakingDeltas = async (params: StakingDeltaQueryParams): Promise<StakingDeltaRow[]> => {
  const { delegator, valoper, limit, beforeHeight, beforeIndex, beforeMsgIndex } = params;
  const candidates = buildCandidateRelations(delegator, valoper);
  const cursor =
    beforeHeight !== undefined && beforeIndex !== undefined && beforeMsgIndex !== undefined
      ? db`WHERE (height, tx_index, msg_index) < (${beforeHeight}, ${beforeIndex}, ${beforeMsgIndex})`
      : db``;

  return db<StakingDeltaRow[]>`
    WITH ${candidates}
    SELECT height, tx_index, msg_index, tx_hash, time, event_type,
      validator_src, validator_dst, denom, amount, sign, source
    FROM all_candidates
    ${cursor}
    ORDER BY height DESC, tx_index DESC, msg_index DESC
    LIMIT ${limit + 1}
  `;
};

export const queryStakingDeltaStats = async (delegator: string, valoper: string): Promise<StakingDeltaStatsRow> => {
  const candidates = buildCandidateRelations(delegator, valoper);
  const rows = await db<StakingDeltaStatsRow[]>`
    WITH ${candidates}
    SELECT
      (SELECT COUNT(*)::bigint FROM all_candidates) AS total,
      (SELECT COUNT(*)::bigint FROM unsafe_msgexec_keys) AS skipped_ambiguous_msgexec
  `;

  return rows[0] ?? { total: BigInt(0), skipped_ambiguous_msgexec: BigInt(0) };
};

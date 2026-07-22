\set ON_ERROR_STOP on
SET jit = off;

-- Incremental refresh of stake.delegator_staking_deltas / stats for the height window
-- (:last_watermark, :new_watermark]. Same resolution logic as the one-time backfill,
-- scoped to only the new blocks since the previous run. Safe to run repeatedly (append-only,
-- ON CONFLICT DO NOTHING on the deltas table; stats deltas are additive per run).

BEGIN;

WITH authz_messages AS MATERIALIZED (
  SELECT m.height, m.tx_hash, m.msg_index, m.value
  FROM core.messages m
  WHERE m.height > :last_watermark AND m.height <= :new_watermark
    AND m.type_url = ANY(ARRAY['/cosmos.authz.v1beta1.MsgExec','/cosmos.authz.v1.MsgExec']::text[])
    AND jsonb_typeof(m.value->'msgs') = 'array'
),
authz_inner AS MATERIALIZED (
  SELECT
    authz.height,
    authz.tx_hash,
    authz.msg_index,
    inner_message.value AS message_value,
    COALESCE(inner_message.value->>'@type', inner_message.value->>'type_url') AS message_type,
    inner_message.value->>'delegator_address' AS delegator_address
  FROM authz_messages authz
  CROSS JOIN LATERAL jsonb_array_elements(authz.value->'msgs') AS inner_message(value)
  WHERE COALESCE(inner_message.value->>'@type', inner_message.value->>'type_url') =
    ANY(ARRAY[
      '/cosmos.staking.v1beta1.MsgDelegate','/cosmos.staking.v1.MsgDelegate',
      '/cosmos.staking.v1beta1.MsgUndelegate','/cosmos.staking.v1.MsgUndelegate',
      '/cosmos.staking.v1beta1.MsgBeginRedelegate','/cosmos.staking.v1.MsgBeginRedelegate',
      '/cosmos.staking.v1beta1.MsgCreateValidator','/cosmos.staking.v1.MsgCreateValidator',
      '/cosmos.staking.v1beta1.MsgCancelUnbondingDelegation','/cosmos.staking.v1.MsgCancelUnbondingDelegation'
    ]::text[])
    AND inner_message.value->>'delegator_address' IS NOT NULL
),
authz_ready AS MATERIALIZED (
  SELECT
    inner_message.height,
    inner_message.tx_hash,
    inner_message.msg_index,
    transaction.tx_index,
    transaction.time,
    inner_message.message_value,
    inner_message.message_type,
    inner_message.delegator_address
  FROM authz_inner inner_message
  JOIN core.transactions transaction
    ON transaction.height = inner_message.height
    AND transaction.tx_hash = inner_message.tx_hash
    AND transaction.code = 0
),
unsafe_msgexec_keys AS MATERIALIZED (
  SELECT height, tx_hash, msg_index, delegator_address
  FROM authz_ready
  GROUP BY height, tx_hash, msg_index, delegator_address
  HAVING COUNT(*) > 1
),
event_candidates AS (
  SELECT
    delegation.delegator_address,
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
  WHERE delegation.height > :last_watermark AND delegation.height <= :new_watermark
    AND delegation.event_type = ANY(ARRAY['delegate','redelegate','unbond']::text[])
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
        AND unsafe.msg_index = delegation.msg_index
        AND unsafe.delegator_address = delegation.delegator_address
    )
),
message_supplements AS (
  SELECT
    message.delegator_address,
    message.height,
    message.tx_index,
    message.msg_index,
    message.tx_hash,
    message.time,
    CASE
      WHEN message.message_type = ANY(ARRAY['/cosmos.staking.v1beta1.MsgCreateValidator','/cosmos.staking.v1.MsgCreateValidator']::text[])
        THEN 'create_validator'
      ELSE 'cancel_unbonding_delegation'
    END AS event_type,
    NULL::text AS validator_src,
    message.message_value->>'validator_address' AS validator_dst,
    CASE
      WHEN message.message_type = ANY(ARRAY['/cosmos.staking.v1beta1.MsgCreateValidator','/cosmos.staking.v1.MsgCreateValidator']::text[])
        THEN message.message_value->'value'->>'denom'
      ELSE message.message_value->'amount'->>'denom'
    END AS denom,
    CASE
      WHEN message.message_type = ANY(ARRAY['/cosmos.staking.v1beta1.MsgCreateValidator','/cosmos.staking.v1.MsgCreateValidator']::text[])
        THEN message.message_value->'value'->>'amount'
      ELSE message.message_value->'amount'->>'amount'
    END AS amount,
    1 AS sign,
    'message'::text AS source
  FROM authz_ready message
  WHERE message.message_type =
    ANY(ARRAY['/cosmos.staking.v1beta1.MsgCreateValidator','/cosmos.staking.v1.MsgCreateValidator','/cosmos.staking.v1beta1.MsgCancelUnbondingDelegation','/cosmos.staking.v1.MsgCancelUnbondingDelegation']::text[])
    AND NOT EXISTS (
      SELECT 1
      FROM unsafe_msgexec_keys unsafe
      WHERE unsafe.height = message.height
        AND unsafe.tx_hash = message.tx_hash
        AND unsafe.msg_index = message.msg_index
        AND unsafe.delegator_address = message.delegator_address
    )
),
valid_message_supplements AS (
  SELECT *
  FROM message_supplements
  WHERE validator_dst IS NOT NULL
    AND denom IS NOT NULL
    AND denom <> ''
    AND amount ~ '^\d+$'
),
direct_message_candidates AS (
  SELECT
    message.value->>'delegator_address' AS delegator_address,
    message.height,
    transaction.tx_index,
    message.msg_index,
    message.tx_hash,
    transaction.time,
    CASE
      WHEN message.type_url = ANY(ARRAY['/cosmos.staking.v1beta1.MsgCreateValidator','/cosmos.staking.v1.MsgCreateValidator']::text[])
        THEN 'create_validator'
      ELSE 'cancel_unbonding_delegation'
    END AS event_type,
    NULL::text AS validator_src,
    message.value->>'validator_address' AS validator_dst,
    CASE
      WHEN message.type_url = ANY(ARRAY['/cosmos.staking.v1beta1.MsgCreateValidator','/cosmos.staking.v1.MsgCreateValidator']::text[])
        THEN message.value->'value'->>'denom'
      ELSE message.value->'amount'->>'denom'
    END AS denom,
    CASE
      WHEN message.type_url = ANY(ARRAY['/cosmos.staking.v1beta1.MsgCreateValidator','/cosmos.staking.v1.MsgCreateValidator']::text[])
        THEN message.value->'value'->>'amount'
      ELSE message.value->'amount'->>'amount'
    END AS amount,
    1 AS sign,
    'message'::text AS source
  FROM core.messages message
  JOIN core.transactions transaction
    ON transaction.height = message.height AND transaction.tx_hash = message.tx_hash
  WHERE message.height > :last_watermark AND message.height <= :new_watermark
    AND transaction.code = 0
    AND message.type_url = ANY(ARRAY[
      '/cosmos.staking.v1beta1.MsgCreateValidator','/cosmos.staking.v1.MsgCreateValidator',
      '/cosmos.staking.v1beta1.MsgCancelUnbondingDelegation','/cosmos.staking.v1.MsgCancelUnbondingDelegation'
    ]::text[])
    AND message.value->>'delegator_address' IS NOT NULL
),
valid_direct_message_candidates AS (
  SELECT *
  FROM direct_message_candidates
  WHERE validator_dst IS NOT NULL
    AND denom IS NOT NULL
    AND denom <> ''
    AND amount ~ '^\d+$'
),
all_candidates AS (
  SELECT * FROM event_candidates
  UNION ALL
  SELECT * FROM valid_message_supplements
  UNION ALL
  SELECT * FROM valid_direct_message_candidates
),
inserted AS (
  INSERT INTO stake.delegator_staking_deltas
    (delegator_address, height, tx_index, msg_index, tx_hash, time, event_type,
     validator_src, validator_dst, denom, amount, sign, source)
  SELECT delegator_address, height, tx_index, msg_index, tx_hash, time, event_type,
    validator_src, validator_dst, denom, amount, sign, source
  FROM all_candidates
  ON CONFLICT (delegator_address, height, tx_index, msg_index) DO NOTHING
  RETURNING delegator_address
),
new_totals AS (
  SELECT delegator_address, count(*) AS total FROM inserted GROUP BY delegator_address
),
new_ambiguous AS (
  SELECT delegator_address, count(*) AS skipped
  FROM (SELECT DISTINCT height, tx_hash, msg_index, delegator_address FROM unsafe_msgexec_keys) dedup
  GROUP BY delegator_address
)
INSERT INTO stake.delegator_staking_delta_stats (delegator_address, total, skipped_ambiguous_msgexec)
SELECT
  coalesce(t.delegator_address, a.delegator_address),
  coalesce(t.total, 0),
  coalesce(a.skipped, 0)
FROM new_totals t
FULL OUTER JOIN new_ambiguous a ON a.delegator_address = t.delegator_address
ON CONFLICT (delegator_address) DO UPDATE
  SET total = stake.delegator_staking_delta_stats.total + EXCLUDED.total,
      skipped_ambiguous_msgexec = stake.delegator_staking_delta_stats.skipped_ambiguous_msgexec + EXCLUDED.skipped_ambiguous_msgexec;

UPDATE stake.staking_deltas_refresh_state SET last_indexed_height = :new_watermark WHERE id = true;

COMMIT;

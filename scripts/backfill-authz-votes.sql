-- Backfill governance votes that were cast through x/authz (MsgExec-wrapped MsgVote).
--
-- Why: before the sink learned to unwrap MsgExec, a validator that delegated voting to
-- a hot-wallet (authz grant on /cosmos.gov.*.MsgVote) had its votes dropped — the
-- top-level message was /cosmos.authz.*.MsgExec and the extractor only matched top-level
-- MsgVote. The inner MsgVote was still decoded and persisted inside core.messages.value
-- (resolveNestedAny runs at decode time), so those historical votes can be recovered with
-- pure SQL — no chain re-sync needed.
--
-- The inner MsgVote.voter is the validator account (the granter), so a recovered row is
-- indistinguishable from a direct vote downstream (gov.votes, the read API, ValidatorInfo).
--
-- Safety:
--   * Gated on tx success (core.transactions.code = 0): a failed MsgExec (expired/revoked/
--     insufficient grant) never applied the vote, so it must not be recorded.
--   * Idempotent (ON CONFLICT DO NOTHING against the gov.votes primary key).
--   * Run once after deploying the sink fix; the live sink handles new blocks going forward.
--
-- Usage:
--   psql "$DATABASE_URL" -f scripts/backfill-authz-votes.sql
--
-- Preflight (optional) — how many authz votes are recoverable before writing anything:
--   SELECT count(*) FROM core.messages m
--   JOIN core.transactions t ON t.tx_hash = m.tx_hash AND t.height = m.height AND t.code = 0
--   CROSS JOIN LATERAL jsonb_array_elements(m.value->'msgs') AS inner_msg
--   WHERE m.type_url IN ('/cosmos.authz.v1beta1.MsgExec', '/cosmos.authz.v1.MsgExec')
--     AND inner_msg->>'@type' IN (
--       '/cosmos.gov.v1beta1.MsgVote', '/cosmos.gov.v1.MsgVote',
--       '/cosmos.gov.v1beta1.MsgVoteWeighted', '/cosmos.gov.v1.MsgVoteWeighted'
--     );

BEGIN;

-- 1. Simple votes: authz-wrapped MsgVote (single `option`, no weight).
INSERT INTO gov.votes (proposal_id, voter, option, weight, height, tx_hash)
SELECT
    (inner_msg->>'proposal_id')::bigint AS proposal_id,
    inner_msg->>'voter'                 AS voter,
    inner_msg->>'option'                AS option,
    NULL::numeric                       AS weight,
    m.height                            AS height,
    m.tx_hash                           AS tx_hash
FROM core.messages m
JOIN core.transactions t
    ON t.tx_hash = m.tx_hash AND t.height = m.height AND t.code = 0
CROSS JOIN LATERAL jsonb_array_elements(m.value->'msgs') AS inner_msg
WHERE m.type_url IN ('/cosmos.authz.v1beta1.MsgExec', '/cosmos.authz.v1.MsgExec')
  AND COALESCE(inner_msg->>'@type', inner_msg->>'type_url') IN ('/cosmos.gov.v1beta1.MsgVote', '/cosmos.gov.v1.MsgVote')
  AND inner_msg->>'voter' IS NOT NULL
  AND inner_msg->>'proposal_id' IS NOT NULL
  AND COALESCE(inner_msg->>'option', '') <> ''
ON CONFLICT DO NOTHING;

-- 2. Weighted votes: authz-wrapped MsgVoteWeighted (one row per `options[]` entry).
--    Weight normalization mirrors the sink: Cosmos SDK emits either an 18-decimal integer
--    ("1000000000000000000" = 1.0) or an already-decimal string ("1.000...").
INSERT INTO gov.votes (proposal_id, voter, option, weight, height, tx_hash)
SELECT
    (inner_msg->>'proposal_id')::bigint AS proposal_id,
    inner_msg->>'voter'                 AS voter,
    opt->>'option'                      AS option,
    CASE
        WHEN opt->>'weight' ~ '^\d+$' THEN (opt->>'weight')::numeric / 1e18
        ELSE (opt->>'weight')::numeric
    END                                 AS weight,
    m.height                            AS height,
    m.tx_hash                           AS tx_hash
FROM core.messages m
JOIN core.transactions t
    ON t.tx_hash = m.tx_hash AND t.height = m.height AND t.code = 0
CROSS JOIN LATERAL jsonb_array_elements(m.value->'msgs') AS inner_msg
-- Guard the SRF: jsonb_array_elements aborts the whole run on a non-array `options`.
-- Only MsgVoteWeighted carries an array here today; the typeof check makes a future
-- inner message with a scalar/object `options` field a no-op instead of a hard failure.
CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(inner_msg->'options') = 'array' THEN inner_msg->'options' ELSE '[]'::jsonb END
) AS opt
WHERE m.type_url IN ('/cosmos.authz.v1beta1.MsgExec', '/cosmos.authz.v1.MsgExec')
  AND COALESCE(inner_msg->>'@type', inner_msg->>'type_url') IN ('/cosmos.gov.v1beta1.MsgVoteWeighted', '/cosmos.gov.v1.MsgVoteWeighted')
  AND inner_msg->>'voter' IS NOT NULL
  AND inner_msg->>'proposal_id' IS NOT NULL
  AND COALESCE(opt->>'option', '') <> ''
ON CONFLICT DO NOTHING;

COMMIT;

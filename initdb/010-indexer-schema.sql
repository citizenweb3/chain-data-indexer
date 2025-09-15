-- initdb/010-indexer-schema.sql
-- Purpose: Base multi-domain schema for Cosmos indexer (core/bank/stake/gov/ibc/wasm/authz_feegrant/groups/tokens/analytics).
-- Notes:
--   * Partitioning strategy kept as-is (RANGE by height, HASH by tx_hash where indicated).
--   * Adds `CREATE EXTENSION IF NOT EXISTS pg_trgm` for trigram indexes.
--   * Adds `COMMENT ON` for key tables/columns to aid discoverability.
--   * Keep migration order: schemas → enums → core → domains → analytics.

-- ============================================================================
-- 0) EXTENSIONS & SCHEMAS
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS bank;
CREATE SCHEMA IF NOT EXISTS stake;
CREATE SCHEMA IF NOT EXISTS gov;
CREATE SCHEMA IF NOT EXISTS ibc;
CREATE SCHEMA IF NOT EXISTS wasm;
CREATE SCHEMA IF NOT EXISTS authz_feegrant;
CREATE SCHEMA IF NOT EXISTS groups;
CREATE SCHEMA IF NOT EXISTS tokens;
CREATE SCHEMA IF NOT EXISTS analytics;

-- Useful enums
DO
$$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ibc_packet_status') THEN
            CREATE TYPE ibc_packet_status AS ENUM ('sent','received','acknowledged','timeout','failed');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'proposal_status') THEN
            CREATE TYPE proposal_status AS ENUM ('deposit_period','voting_period','passed','rejected','failed','withdrawn');
        END IF;
    END
$$;

COMMENT ON TYPE ibc_packet_status IS 'Lifecycle status for IBC packet tracking.';
COMMENT ON TYPE proposal_status IS 'Governance proposal lifecycle status.';

-- ============================================================================
-- 1) BLOCKS / VALIDATORS / VALIDATOR SET
-- Large tables are partitioned by height (RANGE). Typical partition span: ~1M heights.
-- ============================================================================
CREATE TABLE core.blocks
(
    height           BIGINT PRIMARY KEY,
    block_hash       TEXT        NOT NULL,
    time             TIMESTAMPTZ NOT NULL,
    proposer_address TEXT        NOT NULL,
    tx_count         INT         NOT NULL,
    size_bytes       INT         NULL,
    last_commit_hash TEXT        NULL,
    data_hash        TEXT        NULL,
    evidence_count   INT DEFAULT 0,
    app_hash         TEXT        NULL
) PARTITION BY RANGE (height);

-- Example initial partition (provision next partitions from ETL as height grows)
CREATE TABLE IF NOT EXISTS core.blocks_p0 PARTITION OF core.blocks
    FOR VALUES FROM (0) TO (1000000);
-- Next: p1 [1_000_000, 2_000_000), etc.

CREATE INDEX IF NOT EXISTS idx_blocks_time ON core.blocks USING BTREE (time);
CREATE INDEX IF NOT EXISTS idx_blocks_proposer ON core.blocks (proposer_address);
CREATE INDEX IF NOT EXISTS idx_blocks_brin_height ON core.blocks USING BRIN (height);

COMMENT ON TABLE core.blocks IS 'One row per block; partitioned by height.';
COMMENT ON COLUMN core.blocks.height IS 'Absolute block height (partition key).';
COMMENT ON COLUMN core.blocks.proposer_address IS 'Consensus proposer address for the block.';
COMMENT ON COLUMN core.blocks.tx_count IS 'Number of transactions in the block.';

-- Validators (current metadata)
CREATE TABLE core.validators
(
    operator_address    TEXT PRIMARY KEY,
    consensus_address   TEXT UNIQUE,
    consensus_pubkey    TEXT,
    moniker             TEXT,
    website             TEXT,
    details             TEXT,
    commission_rate     NUMERIC(20, 18),
    max_commission_rate NUMERIC(20, 18),
    max_change_rate     NUMERIC(20, 18),
    min_self_delegation NUMERIC(64, 0),
    status              TEXT, -- bonded/unbonded/unbonding
    updated_at_height   BIGINT,
    updated_at_time     TIMESTAMPTZ
);

COMMENT ON TABLE core.validators IS 'Current validator card (denormalized metadata).';
COMMENT ON COLUMN core.validators.operator_address IS 'Bech32 validator operator address.';
COMMENT ON COLUMN core.validators.consensus_address IS 'Consensus address; unique when known.';
COMMENT ON COLUMN core.validators.status IS 'bonded | unbonding | unbonded.';

-- Validator set history (presence/power per block)
CREATE TABLE core.validator_set
(
    height            BIGINT NOT NULL,
    operator_address  TEXT   NOT NULL,
    voting_power      BIGINT NOT NULL,
    proposer_priority BIGINT NULL,
    PRIMARY KEY (height, operator_address)
) PARTITION BY RANGE (height);

CREATE TABLE IF NOT EXISTS core.validator_set_p0 PARTITION OF core.validator_set
    FOR VALUES FROM (0) TO (1000000);

CREATE INDEX IF NOT EXISTS idx_valset_validator ON core.validator_set (operator_address);
CREATE INDEX IF NOT EXISTS idx_valset_brin ON core.validator_set USING BRIN (height);

COMMENT ON TABLE core.validator_set IS 'Per-block validator set snapshot (power, proposer priority).';

-- Missed blocks
CREATE TABLE core.validator_missed_blocks
(
    operator_address TEXT   NOT NULL,
    height           BIGINT NOT NULL,
    PRIMARY KEY (operator_address, height)
) PARTITION BY RANGE (height);

CREATE TABLE IF NOT EXISTS core.validator_missed_blocks_p0 PARTITION OF core.validator_missed_blocks
    FOR VALUES FROM (0) TO (1000000);

CREATE INDEX IF NOT EXISTS idx_missed_brin ON core.validator_missed_blocks USING BRIN (height);

COMMENT ON TABLE core.validator_missed_blocks IS 'Validator missed-block registry (binary presence per height).';

-- ============================================================================
-- 2) TRANSACTIONS / MESSAGES / ABCI EVENTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS core.transactions
(
    tx_hash     TEXT        NOT NULL,
    height      BIGINT      NOT NULL,
    tx_index    INT         NOT NULL,
    code        INT         NOT NULL, -- 0 = success
    gas_wanted  BIGINT      NULL,
    gas_used    BIGINT      NULL,
    fee         JSONB       NULL,
    memo        TEXT        NULL,
    signers     TEXT[]      NULL,
    raw_tx      JSONB       NULL,
    log_summary TEXT        NULL,
    time        TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (height, tx_hash)
) PARTITION BY RANGE (height);

CREATE TABLE IF NOT EXISTS core.transactions_p0 PARTITION OF core.transactions
    FOR VALUES FROM (0) TO (1000000);

CREATE UNIQUE INDEX IF NOT EXISTS uq_txs_height_pos ON core.transactions (height, tx_index);
CREATE INDEX IF NOT EXISTS idx_txs_code ON core.transactions (code);
CREATE INDEX IF NOT EXISTS idx_txs_signers_gin ON core.transactions USING GIN (signers);
CREATE INDEX IF NOT EXISTS idx_txs_time ON core.transactions (time DESC);
CREATE INDEX IF NOT EXISTS idx_txs_success ON core.transactions (height DESC, tx_index) WHERE code = 0;
CREATE INDEX IF NOT EXISTS idx_txs_hash ON core.transactions (tx_hash); -- search by hash without height

COMMENT ON TABLE core.transactions IS 'One row per transaction; partitioned by height.';
COMMENT ON COLUMN core.transactions.code IS 'ABCI code: 0 = success, non-zero = failure.';
COMMENT ON COLUMN core.transactions.fee IS 'Raw JSON fee object from SDK.';
COMMENT ON COLUMN core.transactions.signers IS 'Ordered signer addresses (bech32).';

-- Messages (Tx body items)
CREATE TABLE IF NOT EXISTS core.messages
(
    tx_hash   TEXT   NOT NULL,
    msg_index INT    NOT NULL,
    height    BIGINT NOT NULL,
    type_url  TEXT   NOT NULL,
    value     JSONB  NOT NULL,
    signer    TEXT   NULL,
    PRIMARY KEY (height, tx_hash, msg_index)
) PARTITION BY RANGE (height);

CREATE TABLE IF NOT EXISTS core.messages_p0 PARTITION OF core.messages
    FOR VALUES FROM (0) TO (1000000);

CREATE INDEX IF NOT EXISTS idx_msgs_height_type ON core.messages (height DESC, type_url);
CREATE INDEX IF NOT EXISTS idx_msgs_signer ON core.messages (signer, height DESC);
CREATE INDEX IF NOT EXISTS idx_msgs_value_path ON core.messages USING GIN (value jsonb_path_ops);
CREATE INDEX IF NOT EXISTS idx_msgs_txhash_msg ON core.messages (tx_hash, msg_index);

COMMENT ON TABLE core.messages IS 'Decoded Tx body messages (protobuf Any).';
COMMENT ON COLUMN core.messages.type_url IS 'Message protobuf type URL, e.g. /cosmos.bank.v1beta1.MsgSend.';
COMMENT ON COLUMN core.messages.value IS 'Decoded message payload as JSONB.';

-- Events (ABCI logs per message or tx-level)
CREATE TABLE core.events
(
    tx_hash     TEXT  NOT NULL,
    msg_index   INT   NOT NULL, -- -1 for tx-level events
    event_index INT   NOT NULL,
    event_type  TEXT  NOT NULL, -- e.g. "transfer", "wasm", "delegate"
    attributes  JSONB NOT NULL, -- [{key,value}, ...] or map
    PRIMARY KEY (tx_hash, msg_index, event_index)
) PARTITION BY HASH (tx_hash);

CREATE INDEX IF NOT EXISTS idx_events_type ON core.events (event_type);

COMMENT ON TABLE core.events IS 'ABCI events grouped per (tx_hash, msg_index, ordinal).';
COMMENT ON COLUMN core.events.msg_index IS 'Message index; -1 for transaction-scoped events.';
COMMENT ON COLUMN core.events.attributes IS 'Array of key/value pairs (or map) as JSONB.';

-- Attribute fan-out (fast WHERE key/value filters)
CREATE TABLE core.event_attrs
(
    tx_hash     TEXT NOT NULL,
    msg_index   INT  NOT NULL,
    event_index INT  NOT NULL,
    key         TEXT NOT NULL,
    value       TEXT NULL,
    PRIMARY KEY (tx_hash, msg_index, event_index, key)
);

CREATE INDEX IF NOT EXISTS idx_event_attrs_key ON core.event_attrs (key);
CREATE INDEX IF NOT EXISTS idx_event_attrs_key_value_md5 ON core.event_attrs (key, md5(COALESCE(value, '')));
CREATE INDEX IF NOT EXISTS idx_event_attrs_value_trgm ON core.event_attrs USING GIN (value gin_trgm_ops);

COMMENT ON TABLE core.event_attrs IS 'Flattened ABCI event attributes for direct key/value lookups.';

-- ============================================================================
-- 3) BANK / TRANSFERS / BALANCE SNAPSHOTS
-- ============================================================================
-- Denormalized transfer registry (fast in/out queries)
CREATE TABLE IF NOT EXISTS bank.transfers
(
    tx_hash   TEXT           NOT NULL,
    msg_index INT            NOT NULL,
    from_addr TEXT           NOT NULL,
    to_addr   TEXT           NOT NULL,
    denom     TEXT           NOT NULL,
    amount    NUMERIC(80, 0) NOT NULL,
    height    BIGINT         NOT NULL,
    PRIMARY KEY (height, tx_hash, msg_index, from_addr, to_addr, denom)
) PARTITION BY RANGE (height);

CREATE TABLE IF NOT EXISTS bank.transfers_p0 PARTITION OF bank.transfers
    FOR VALUES FROM (0) TO (1000000);

CREATE INDEX IF NOT EXISTS idx_transfers_from ON bank.transfers (from_addr, height DESC);
CREATE INDEX IF NOT EXISTS idx_transfers_to ON bank.transfers (to_addr, height DESC);
CREATE INDEX IF NOT EXISTS idx_transfers_denom ON bank.transfers (denom);
CREATE INDEX IF NOT EXISTS idx_transfers_brin_height ON bank.transfers USING BRIN (height);

ALTER TABLE bank.transfers
    ADD CONSTRAINT chk_transfer_addr_len
        CHECK (length(from_addr) BETWEEN 10 AND 128 AND length(to_addr) BETWEEN 10 AND 128);

COMMENT ON TABLE bank.transfers IS 'Token transfers extracted from bank messages/events.';
COMMENT ON COLUMN bank.transfers.amount IS 'Integer amount in base units.';
COMMENT ON COLUMN bank.transfers.denom IS 'Denomination (e.g., uatom).';

-- Incremental balance deltas (optional; large)
CREATE TABLE bank.balance_deltas
(
    height  BIGINT         NOT NULL,
    account TEXT           NOT NULL,
    denom   TEXT           NOT NULL,
    delta   NUMERIC(80, 0) NOT NULL, -- +/-
    PRIMARY KEY (height, account, denom)
) PARTITION BY RANGE (height);

CREATE TABLE IF NOT EXISTS bank.balance_deltas_p0 PARTITION OF bank.balance_deltas
    FOR VALUES FROM (0) TO (1000000);

CREATE INDEX IF NOT EXISTS idx_bal_deltas_account ON bank.balance_deltas (account, denom, height);

COMMENT ON TABLE bank.balance_deltas IS 'Delta ledger for balances; maintain via ETL (append-only).';

-- Materialized current balances (maintained by ETL)
CREATE TABLE bank.balances_current
(
    account  TEXT PRIMARY KEY,
    balances JSONB NOT NULL -- {denom: amount, ...}
);

COMMENT ON TABLE bank.balances_current IS 'Materialized current balances per account as JSON map.';

-- ============================================================================
-- 4) STAKING / DISTRIBUTION
-- ============================================================================
-- Delegations (event history)
CREATE TABLE stake.delegation_events
(
    height            BIGINT         NOT NULL,
    tx_hash           TEXT           NOT NULL,
    msg_index         INT            NOT NULL,
    event_type        TEXT           NOT NULL, -- delegate|redelegate|undelegate|complete_unbonding
    delegator_address TEXT           NOT NULL,
    validator_src     TEXT           NULL,
    validator_dst     TEXT           NULL,
    denom             TEXT           NOT NULL,
    amount            NUMERIC(80, 0) NOT NULL,
    completion_time   TIMESTAMPTZ    NULL,
    PRIMARY KEY (height, tx_hash, msg_index)
) PARTITION BY RANGE (height);

CREATE TABLE IF NOT EXISTS stake.delegation_events_p0 PARTITION OF stake.delegation_events
    FOR VALUES FROM (0) TO (1000000);

CREATE INDEX IF NOT EXISTS idx_del_ev_delegator ON stake.delegation_events (delegator_address, height DESC);
CREATE INDEX IF NOT EXISTS idx_del_ev_valdst ON stake.delegation_events (validator_dst, height DESC);
CREATE INDEX IF NOT EXISTS idx_del_ev_valsrc ON stake.delegation_events (validator_src, height DESC);

COMMENT ON TABLE stake.delegation_events IS 'Staking delegation lifecycle events.';

-- Aggregated current delegations (maintained by ETL)
CREATE TABLE stake.delegations_current
(
    delegator_address TEXT           NOT NULL,
    validator_address TEXT           NOT NULL,
    denom             TEXT           NOT NULL,
    amount            NUMERIC(80, 0) NOT NULL,
    PRIMARY KEY (delegator_address, validator_address, denom)
);

COMMENT ON TABLE stake.delegations_current IS 'Materialized current state of delegations.';

-- Distribution events (rewards/commission)
CREATE TABLE stake.distribution_events
(
    height            BIGINT         NOT NULL,
    tx_hash           TEXT           NOT NULL,
    msg_index         INT            NOT NULL,
    event_type        TEXT           NOT NULL, -- withdraw_rewards|withdraw_commission|set_withdraw_addr
    delegator_address TEXT           NULL,
    validator_address TEXT           NULL,
    denom             TEXT           NULL,
    amount            NUMERIC(80, 0) NULL,
    withdraw_address  TEXT           NULL,
    PRIMARY KEY (height, tx_hash, msg_index)
) PARTITION BY RANGE (height);

CREATE TABLE IF NOT EXISTS stake.distribution_events_p0 PARTITION OF stake.distribution_events
    FOR VALUES FROM (0) TO (1000000);

CREATE INDEX IF NOT EXISTS idx_dist_ev_validator ON stake.distribution_events (validator_address, height DESC);
CREATE INDEX IF NOT EXISTS idx_dist_ev_delegator ON stake.distribution_events (delegator_address, height DESC);

COMMENT ON TABLE stake.distribution_events IS 'Distribution-related events: rewards, commission, address changes.';

-- ============================================================================
-- 5) GOVERNANCE
-- ============================================================================
CREATE TABLE gov.proposals
(
    proposal_id   BIGINT PRIMARY KEY,
    submitter     TEXT            NULL,
    title         TEXT            NOT NULL,
    summary       TEXT            NULL,
    proposal_type TEXT            NULL, -- text/type_url
    status        proposal_status NOT NULL,
    deposit_end   TIMESTAMPTZ     NULL,
    voting_start  TIMESTAMPTZ     NULL,
    voting_end    TIMESTAMPTZ     NULL,
    total_deposit JSONB           NULL, -- [{denom,amount}...]
    changes       JSONB           NULL, -- param changes, etc.
    submit_time   TIMESTAMPTZ     NULL
);

CREATE INDEX IF NOT EXISTS idx_gov_status ON gov.proposals (status);

COMMENT ON TABLE gov.proposals IS 'Governance proposals catalog with lifecycle timestamps.';

CREATE TABLE gov.deposits
(
    proposal_id BIGINT         NOT NULL,
    depositor   TEXT           NOT NULL,
    denom       TEXT           NOT NULL,
    amount      NUMERIC(80, 0) NOT NULL,
    height      BIGINT         NOT NULL,
    tx_hash     TEXT           NOT NULL,
    PRIMARY KEY (proposal_id, depositor, denom, height, tx_hash)
) PARTITION BY RANGE (height);

CREATE TABLE IF NOT EXISTS gov.deposits_p0 PARTITION OF gov.deposits
    FOR VALUES FROM (0) TO (1000000);

CREATE INDEX IF NOT EXISTS idx_gov_dep_depositor ON gov.deposits (depositor, height DESC);

COMMENT ON TABLE gov.deposits IS 'Proposal deposits history by depositor/denom.';

CREATE TABLE gov.votes
(
    proposal_id BIGINT          NOT NULL,
    voter       TEXT            NOT NULL,
    option      TEXT            NOT NULL, -- Yes/No/NoWithVeto/Abstain (+ weighted)
    weight      NUMERIC(20, 18) NULL,     -- for weighted
    height      BIGINT          NOT NULL,
    tx_hash     TEXT            NOT NULL,
    PRIMARY KEY (proposal_id, voter, height, tx_hash)
) PARTITION BY RANGE (height);

CREATE TABLE IF NOT EXISTS gov.votes_p0 PARTITION OF gov.votes
    FOR VALUES FROM (0) TO (1000000);

CREATE INDEX IF NOT EXISTS idx_gov_votes_voter ON gov.votes (voter, height DESC);
CREATE INDEX IF NOT EXISTS idx_gov_votes_prop ON gov.votes (proposal_id, option);

COMMENT ON TABLE gov.votes IS 'Governance votes (includes weighted options when applicable).';

-- ============================================================================
-- 6) IBC
-- ============================================================================
CREATE TABLE ibc.channels
(
    port_id              TEXT   NOT NULL,
    channel_id           TEXT   NOT NULL,
    state                TEXT   NULL, -- STATE_{INIT|TRYOPEN|OPEN|CLOSED}
    ordering             TEXT   NULL, -- ORDER_{ORDERED|UNORDERED}
    connection_hops      TEXT[] NULL,
    counterparty_port    TEXT   NULL,
    counterparty_channel TEXT   NULL,
    version              TEXT   NULL,
    PRIMARY KEY (port_id, channel_id)
);

COMMENT ON TABLE ibc.channels IS 'IBC channel metadata keyed by (port, channel).';

CREATE TABLE ibc.packets
(
    port_id_src    TEXT              NOT NULL,
    channel_id_src TEXT              NOT NULL,
    sequence       BIGINT            NOT NULL,
    port_id_dst    TEXT              NULL,
    channel_id_dst TEXT              NULL,
    timeout_height TEXT              NULL,
    timeout_ts     BIGINT            NULL,
    status         ibc_packet_status NOT NULL,
    tx_hash_send   TEXT              NULL,
    height_send    BIGINT            NULL,
    tx_hash_recv   TEXT              NULL,
    height_recv    BIGINT            NULL,
    tx_hash_ack    TEXT              NULL,
    height_ack     BIGINT            NULL,
    relayer        TEXT              NULL,
    denom          TEXT              NULL,
    amount         NUMERIC(80, 0)    NULL,
    memo           TEXT              NULL,
    PRIMARY KEY (channel_id_src, port_id_src, sequence)
) PARTITION BY RANGE (sequence);

CREATE TABLE IF NOT EXISTS ibc.packets_p0 PARTITION OF ibc.packets
    FOR VALUES FROM (0) TO (1000000);

CREATE INDEX IF NOT EXISTS idx_ibc_packets_status ON ibc.packets (status);
CREATE INDEX IF NOT EXISTS idx_ibc_packets_rel ON ibc.packets (relayer);

COMMENT ON TABLE ibc.packets IS 'Packet send/recv/ack timeline with amounts and relayer.';

CREATE TABLE ibc.denoms
(
    denom_hash TEXT PRIMARY KEY, -- 'ibc/XXXX'
    base_denom TEXT NOT NULL,
    trace_path TEXT NOT NULL     -- transfer/channel-XX/...
);

CREATE INDEX IF NOT EXISTS idx_ibc_denoms_base ON ibc.denoms (base_denom);

COMMENT ON TABLE ibc.denoms IS 'ICS-20 denom traces: ibc/… → base denom via path.';

-- ============================================================================
-- 7) COSMWASM
-- ============================================================================
CREATE TABLE wasm.codes
(
    code_id                BIGINT PRIMARY KEY,
    checksum               TEXT   NOT NULL,
    creator                TEXT   NULL,
    instantiate_permission JSONB  NULL,
    store_tx_hash          TEXT   NULL,
    store_height           BIGINT NULL
);

COMMENT ON TABLE wasm.codes IS 'Stored code artifacts (checksums, permissions, provenance).';

CREATE TABLE wasm.contracts
(
    address         TEXT PRIMARY KEY,
    code_id         BIGINT NOT NULL REFERENCES wasm.codes (code_id),
    creator         TEXT   NULL,
    admin           TEXT   NULL,
    label           TEXT   NULL,
    created_height  BIGINT NULL,
    created_tx_hash TEXT   NULL
);

CREATE INDEX IF NOT EXISTS idx_wasm_contracts_code ON wasm.contracts (code_id);

COMMENT ON TABLE wasm.contracts IS 'Instantiated contracts mapped to code_id.';

-- Migrations
CREATE TABLE wasm.contract_migrations
(
    contract     TEXT   NOT NULL REFERENCES wasm.contracts (address) ON DELETE CASCADE,
    from_code_id BIGINT NULL,
    to_code_id   BIGINT NOT NULL,
    height       BIGINT NOT NULL,
    tx_hash      TEXT   NOT NULL,
    PRIMARY KEY (contract, height, tx_hash)
) PARTITION BY RANGE (height);

CREATE TABLE IF NOT EXISTS wasm.contract_migrations_p0 PARTITION OF wasm.contract_migrations
    FOR VALUES FROM (0) TO (1000000);

COMMENT ON TABLE wasm.contract_migrations IS 'Contract code migrations over time.';

-- Execute calls
CREATE TABLE IF NOT EXISTS wasm.executions
(
    tx_hash   TEXT    NOT NULL,
    msg_index INT     NOT NULL,
    contract  TEXT    NOT NULL,
    caller    TEXT    NULL,
    funds     JSONB   NULL,
    msg       JSONB   NOT NULL,
    success   BOOLEAN NOT NULL,
    error     TEXT    NULL,
    gas_used  BIGINT  NULL,
    height    BIGINT  NOT NULL,
    PRIMARY KEY (height, tx_hash, msg_index)
) PARTITION BY RANGE (height);

CREATE TABLE IF NOT EXISTS wasm.executions_p0 PARTITION OF wasm.executions
    FOR VALUES FROM (0) TO (1000000);

CREATE INDEX IF NOT EXISTS idx_wasm_exec_contract ON wasm.executions (contract, height DESC);
CREATE INDEX IF NOT EXISTS idx_wasm_exec_msg_gin ON wasm.executions USING GIN (msg jsonb_path_ops);
CREATE INDEX IF NOT EXISTS idx_wasm_exec_success ON wasm.executions (success);
CREATE INDEX IF NOT EXISTS idx_wasm_exec_tx_msg ON wasm.executions (tx_hash, msg_index);

COMMENT ON TABLE wasm.executions IS 'Execute invocations with decoded message and result status.';

-- wasm events (optional denormalized layer)
CREATE TABLE IF NOT EXISTS wasm.events
(
    contract   TEXT   NOT NULL,
    height     BIGINT NOT NULL,
    tx_hash    TEXT   NOT NULL,
    msg_index  INT    NOT NULL,
    event_type TEXT   NOT NULL,
    attributes JSONB  NOT NULL,
    PRIMARY KEY (height, tx_hash, msg_index, event_type)
) PARTITION BY RANGE (height);

CREATE TABLE IF NOT EXISTS wasm.events_p0 PARTITION OF wasm.events
    FOR VALUES FROM (0) TO (1000000);

CREATE INDEX IF NOT EXISTS idx_wasm_events_contract ON wasm.events (contract, height DESC);
CREATE INDEX IF NOT EXISTS idx_wasm_events_type ON wasm.events (event_type);
CREATE INDEX IF NOT EXISTS idx_wasm_events_tx_msg ON wasm.events (tx_hash, msg_index);

COMMENT ON TABLE wasm.events IS 'Denormalized wasm-specific events for faster contract-centric queries.';

-- Historical KV store (time-travel)
CREATE TABLE wasm.state_kv
(
    contract   TEXT   NOT NULL,
    key        BYTEA  NOT NULL, -- raw key
    key_prefix BYTEA  NULL,     -- extracted prefix for faster scans
    height     BIGINT NOT NULL,
    value      BYTEA  NOT NULL, -- raw value (or JSONB if you decode separately)
    PRIMARY KEY (contract, key, height)
) PARTITION BY RANGE (height);

CREATE TABLE IF NOT EXISTS wasm.state_kv_p0 PARTITION OF wasm.state_kv
    FOR VALUES FROM (0) TO (1000000);

CREATE INDEX IF NOT EXISTS idx_wasm_state_prefix ON wasm.state_kv (contract, key_prefix, height);

COMMENT ON TABLE wasm.state_kv IS 'Historical key/value snapshots of contract storage.';

-- ============================================================================
-- 8) CW20 (specialized wasm pattern)
-- ============================================================================
CREATE TABLE IF NOT EXISTS tokens.cw20_transfers
(
    contract  TEXT           NOT NULL,
    from_addr TEXT           NOT NULL,
    to_addr   TEXT           NOT NULL,
    amount    NUMERIC(80, 0) NOT NULL,
    height    BIGINT         NOT NULL,
    tx_hash   TEXT           NOT NULL,
    PRIMARY KEY (height, tx_hash, contract, from_addr, to_addr)
) PARTITION BY RANGE (height);

CREATE TABLE IF NOT EXISTS tokens.cw20_transfers_p0 PARTITION OF tokens.cw20_transfers
    FOR VALUES FROM (0) TO (1000000);

CREATE INDEX IF NOT EXISTS idx_cw20_from ON tokens.cw20_transfers (contract, from_addr, height DESC);
CREATE INDEX IF NOT EXISTS idx_cw20_to ON tokens.cw20_transfers (contract, to_addr, height DESC);
CREATE INDEX IF NOT EXISTS idx_cw20_brin ON tokens.cw20_transfers USING BRIN (height);
CREATE INDEX IF NOT EXISTS idx_cw20_tx ON tokens.cw20_transfers (tx_hash);

COMMENT ON TABLE tokens.cw20_transfers IS 'CW20 token transfer events (denormalized).';

-- Optional snapshots: maintain via periodic job
CREATE TABLE tokens.cw20_balances_current
(
    contract TEXT           NOT NULL,
    account  TEXT           NOT NULL,
    balance  NUMERIC(80, 0) NOT NULL,
    PRIMARY KEY (contract, account)
);

COMMENT ON TABLE tokens.cw20_balances_current IS 'Materialized current CW20 balances per contract/account.';

-- ============================================================================
-- 9) AUTHZ / FEEGRANT
-- ============================================================================
CREATE TABLE authz_feegrant.authz_grants
(
    granter      TEXT        NOT NULL,
    grantee      TEXT        NOT NULL,
    msg_type_url TEXT        NOT NULL,
    expiration   TIMESTAMPTZ NULL,
    height       BIGINT      NOT NULL,
    revoked      BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (granter, grantee, msg_type_url, height)
) PARTITION BY RANGE (height);

CREATE TABLE IF NOT EXISTS authz_feegrant.authz_grants_p0 PARTITION OF authz_feegrant.authz_grants
    FOR VALUES FROM (0) TO (1000000);

CREATE INDEX IF NOT EXISTS idx_authz_grantee ON authz_feegrant.authz_grants (grantee, msg_type_url, height DESC);

COMMENT ON TABLE authz_feegrant.authz_grants IS 'Authz grants (capabilities) lifecycle, partitioned by height.';

CREATE TABLE authz_feegrant.fee_grants
(
    granter    TEXT        NOT NULL,
    grantee    TEXT        NOT NULL,
    allowance  JSONB       NOT NULL,
    expiration TIMESTAMPTZ NULL,
    height     BIGINT      NOT NULL,
    revoked    BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (granter, grantee, height)
) PARTITION BY RANGE (height);

CREATE TABLE IF NOT EXISTS authz_feegrant.fee_grants_p0 PARTITION OF authz_feegrant.fee_grants
    FOR VALUES FROM (0) TO (1000000);

CREATE INDEX IF NOT EXISTS idx_feegrant_grantee ON authz_feegrant.fee_grants (grantee, height DESC);

COMMENT ON TABLE authz_feegrant.fee_grants IS 'Fee grants and allowances between accounts.';

-- ============================================================================
-- 10) GROUPS (DAO)
-- ============================================================================
CREATE TABLE groups.groups
(
    group_id BIGINT PRIMARY KEY,
    admin    TEXT NOT NULL,
    metadata TEXT NULL
);

COMMENT ON TABLE groups.groups IS 'Group (DAO) metadata and admin.';

CREATE TABLE groups.members
(
    group_id BIGINT         NOT NULL REFERENCES groups.groups (group_id) ON DELETE CASCADE,
    member   TEXT           NOT NULL,
    weight   NUMERIC(20, 6) NOT NULL,
    metadata TEXT           NULL,
    PRIMARY KEY (group_id, member)
);

COMMENT ON TABLE groups.members IS 'Group members with voting weights.';

CREATE TABLE groups.proposals
(
    proposal_id BIGINT PRIMARY KEY,
    group_id    BIGINT      NOT NULL REFERENCES groups.groups (group_id) ON DELETE CASCADE,
    proposer    TEXT        NOT NULL,
    metadata    TEXT        NULL,
    status      TEXT        NOT NULL,
    submit_time TIMESTAMPTZ NULL
);

COMMENT ON TABLE groups.proposals IS 'Group proposals and basic lifecycle status.';

CREATE TABLE groups.votes
(
    proposal_id BIGINT          NOT NULL REFERENCES groups.proposals (proposal_id) ON DELETE CASCADE,
    voter       TEXT            NOT NULL,
    option      TEXT            NOT NULL,
    weight      NUMERIC(20, 18) NULL,
    height      BIGINT          NOT NULL,
    PRIMARY KEY (proposal_id, voter, height)
);

COMMENT ON TABLE groups.votes IS 'Votes for group proposals (supports weighted voting).';

-- ============================================================================
-- 11) NETWORK / APP & CONSENSUS PARAMS
-- ============================================================================
CREATE TABLE core.network_params
(
    height    BIGINT PRIMARY KEY,
    time      TIMESTAMPTZ NOT NULL,
    module    TEXT        NOT NULL,
    param_key TEXT        NOT NULL,
    old_value JSONB       NULL,
    new_value JSONB       NOT NULL
) PARTITION BY RANGE (height);

CREATE TABLE IF NOT EXISTS core.network_params_p0 PARTITION OF core.network_params
    FOR VALUES FROM (0) TO (1000000);

CREATE INDEX IF NOT EXISTS idx_params_module_key ON core.network_params (module, param_key, height DESC);

COMMENT ON TABLE core.network_params IS 'Parameter changes across modules (app/consensus).';

-- ============================================================================
-- 12) ANALYTICS (precomputed aggregates for specific use-cases)
-- ============================================================================
-- Example: validator uptime/misses by day
CREATE TABLE analytics.validator_uptime_daily
(
    day              DATE NOT NULL,
    operator_address TEXT NOT NULL,
    signed_blocks    INT  NOT NULL,
    missed_blocks    INT  NOT NULL,
    PRIMARY KEY (day, operator_address)
);

COMMENT ON TABLE analytics.validator_uptime_daily IS 'Daily validator uptime/missed block counts.';

-- Example: gas profile by message type
CREATE TABLE analytics.msg_gas_profile_daily
(
    day          DATE   NOT NULL,
    type_url     TEXT   NOT NULL,
    count        BIGINT NOT NULL,
    gas_used_p50 BIGINT NULL,
    gas_used_p95 BIGINT NULL,
    PRIMARY KEY (day, type_url)
);

COMMENT ON TABLE analytics.msg_gas_profile_daily IS 'Daily aggregates: count and gas percentiles by message type.';
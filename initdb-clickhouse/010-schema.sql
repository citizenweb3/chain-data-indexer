-- initdb-clickhouse/010-schema.sql
-- Purpose: ClickHouse mirror of the business tables from initdb/010-indexer-schema.sql.
-- Excludes util helpers and the Postgres resume-state helper table; ClickHouse resume derives from max(height) in core.blocks.
-- Type mapping: JSONB/BYTEA -> String, TEXT[] -> Array(String), TIMESTAMPTZ -> DateTime64(3, 'UTC').

CREATE DATABASE IF NOT EXISTS core;
CREATE DATABASE IF NOT EXISTS bank;
CREATE DATABASE IF NOT EXISTS stake;
CREATE DATABASE IF NOT EXISTS gov;
CREATE DATABASE IF NOT EXISTS ibc;
CREATE DATABASE IF NOT EXISTS wasm;
CREATE DATABASE IF NOT EXISTS authz_feegrant;
CREATE DATABASE IF NOT EXISTS groups;
CREATE DATABASE IF NOT EXISTS tokens;
CREATE DATABASE IF NOT EXISTS analytics;

-- ==========================================================================
-- Core chain data
-- ==========================================================================
CREATE TABLE IF NOT EXISTS core.blocks
(
    height UInt64,
    block_hash String,
    time DateTime64(3, 'UTC'),
    proposer_address String,
    tx_count UInt32,
    size_bytes Nullable(UInt32),
    last_commit_hash Nullable(String),
    data_hash Nullable(String),
    evidence_count UInt32 DEFAULT 0,
    app_hash Nullable(String)
)
ENGINE = ReplacingMergeTree
PARTITION BY intDiv(height, 1000000)
ORDER BY (height);

CREATE TABLE IF NOT EXISTS core.validators
(
    operator_address String,
    consensus_address Nullable(String),
    consensus_pubkey Nullable(String),
    moniker Nullable(String),
    website Nullable(String),
    details Nullable(String),
    commission_rate Nullable(Decimal(20, 18)),
    max_commission_rate Nullable(Decimal(20, 18)),
    max_change_rate Nullable(Decimal(20, 18)),
    min_self_delegation Nullable(Decimal128(0)),
    status Nullable(String),
    updated_at_height Nullable(UInt64),
    updated_at_time Nullable(DateTime64(3, 'UTC'))
)
ENGINE = ReplacingMergeTree
ORDER BY (operator_address);

CREATE TABLE IF NOT EXISTS core.validator_set
(
    height UInt64,
    operator_address String,
    voting_power UInt64,
    proposer_priority Nullable(Int64)
)
ENGINE = ReplacingMergeTree
PARTITION BY intDiv(height, 1000000)
ORDER BY (height, operator_address);

CREATE TABLE IF NOT EXISTS core.validator_missed_blocks
(
    operator_address String,
    height UInt64
)
ENGINE = ReplacingMergeTree
PARTITION BY intDiv(height, 1000000)
ORDER BY (operator_address, height);

CREATE TABLE IF NOT EXISTS core.transactions
(
    tx_hash String,
    height UInt64,
    tx_index UInt32,
    code UInt32,
    gas_wanted Nullable(UInt64),
    gas_used Nullable(UInt64),
    fee Nullable(String),
    memo Nullable(String),
    signers Array(String),
    raw_tx Nullable(String),
    log_summary Nullable(String),
    time DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree
PARTITION BY intDiv(height, 1000000)
ORDER BY (height, tx_hash);

CREATE TABLE IF NOT EXISTS core.messages
(
    tx_hash String,
    msg_index Int32,
    height UInt64,
    type_url String,
    value String,
    signer Nullable(String)
)
ENGINE = ReplacingMergeTree
PARTITION BY intDiv(height, 1000000)
ORDER BY (height, tx_hash, msg_index);

CREATE TABLE IF NOT EXISTS core.events
(
    tx_hash String,
    msg_index Int32,
    event_index UInt32,
    event_type String,
    attributes String,
    height UInt64
)
ENGINE = ReplacingMergeTree
PARTITION BY intDiv(height, 1000000)
ORDER BY (height, tx_hash, msg_index, event_index);

CREATE TABLE IF NOT EXISTS core.event_attrs
(
    height UInt64,
    tx_hash String,
    msg_index Int32,
    event_index UInt32,
    key String,
    value Nullable(String)
)
ENGINE = ReplacingMergeTree
PARTITION BY intDiv(height, 1000000)
ORDER BY (height, tx_hash, msg_index, event_index, key);

CREATE TABLE IF NOT EXISTS core.network_params
(
    height UInt64,
    time DateTime64(3, 'UTC'),
    module String,
    param_key String,
    old_value Nullable(String),
    new_value String
)
ENGINE = ReplacingMergeTree
PARTITION BY intDiv(height, 1000000)
ORDER BY (module, param_key, height);

-- ==========================================================================
-- Bank
-- ==========================================================================
CREATE TABLE IF NOT EXISTS bank.transfers
(
    tx_hash String,
    msg_index Int32,
    from_addr String,
    to_addr String,
    denom String,
    amount Decimal128(0),
    height UInt64
)
ENGINE = ReplacingMergeTree
PARTITION BY intDiv(height, 1000000)
ORDER BY (height, tx_hash, msg_index, from_addr, to_addr, denom);

CREATE TABLE IF NOT EXISTS bank.balance_deltas
(
    height UInt64,
    account String,
    denom String,
    delta Decimal128(0)
)
ENGINE = ReplacingMergeTree
PARTITION BY intDiv(height, 1000000)
ORDER BY (height, account, denom);

CREATE TABLE IF NOT EXISTS bank.balances_current
(
    account String,
    balances String
)
ENGINE = ReplacingMergeTree
ORDER BY (account);

-- ==========================================================================
-- Staking
-- ==========================================================================
CREATE TABLE IF NOT EXISTS stake.delegation_events
(
    height UInt64,
    tx_hash String,
    msg_index Int32,
    event_type String,
    delegator_address String,
    validator_src Nullable(String),
    validator_dst Nullable(String),
    denom String,
    amount Decimal128(0),
    completion_time Nullable(DateTime64(3, 'UTC'))
)
ENGINE = ReplacingMergeTree
PARTITION BY intDiv(height, 1000000)
ORDER BY (height, tx_hash, msg_index);

CREATE TABLE IF NOT EXISTS stake.delegations_current
(
    delegator_address String,
    validator_address String,
    denom String,
    amount Decimal128(0)
)
ENGINE = ReplacingMergeTree
ORDER BY (delegator_address, validator_address, denom);

CREATE TABLE IF NOT EXISTS stake.distribution_events
(
    height UInt64,
    tx_hash String,
    msg_index Int32,
    event_type String,
    delegator_address Nullable(String),
    validator_address Nullable(String),
    denom Nullable(String),
    amount Nullable(Decimal128(0)),
    withdraw_address Nullable(String)
)
ENGINE = ReplacingMergeTree
PARTITION BY intDiv(height, 1000000)
ORDER BY (height, tx_hash, msg_index);

-- ==========================================================================
-- Governance
-- ==========================================================================
CREATE TABLE IF NOT EXISTS gov.proposals
(
    proposal_id UInt64,
    submitter Nullable(String),
    title String,
    summary Nullable(String),
    proposal_type Nullable(String),
    status String,
    deposit_end Nullable(DateTime64(3, 'UTC')),
    voting_start Nullable(DateTime64(3, 'UTC')),
    voting_end Nullable(DateTime64(3, 'UTC')),
    total_deposit Nullable(String),
    changes Nullable(String),
    submit_time Nullable(DateTime64(3, 'UTC'))
)
ENGINE = ReplacingMergeTree
ORDER BY (proposal_id);

CREATE TABLE IF NOT EXISTS gov.deposits
(
    proposal_id UInt64,
    depositor String,
    denom String,
    amount Decimal128(0),
    height UInt64,
    tx_hash String
)
ENGINE = ReplacingMergeTree
PARTITION BY intDiv(height, 1000000)
ORDER BY (proposal_id, depositor, denom, height, tx_hash);

CREATE TABLE IF NOT EXISTS gov.votes
(
    proposal_id UInt64,
    voter String,
    option String,
    weight Nullable(Decimal(20, 18)),
    height UInt64,
    tx_hash String
)
ENGINE = ReplacingMergeTree
PARTITION BY intDiv(height, 1000000)
ORDER BY (proposal_id, voter, height, tx_hash);

-- ==========================================================================
-- IBC
-- ==========================================================================
CREATE TABLE IF NOT EXISTS ibc.channels
(
    port_id String,
    channel_id String,
    state Nullable(String),
    ordering Nullable(String),
    connection_hops Array(String),
    counterparty_port Nullable(String),
    counterparty_channel Nullable(String),
    version Nullable(String)
)
ENGINE = ReplacingMergeTree
ORDER BY (port_id, channel_id);

CREATE TABLE IF NOT EXISTS ibc.packets
(
    port_id_src String,
    channel_id_src String,
    sequence UInt64,
    port_id_dst Nullable(String),
    channel_id_dst Nullable(String),
    timeout_height Nullable(String),
    timeout_ts Nullable(UInt64),
    status String,
    tx_hash_send Nullable(String),
    height_send Nullable(UInt64),
    tx_hash_recv Nullable(String),
    height_recv Nullable(UInt64),
    tx_hash_ack Nullable(String),
    height_ack Nullable(UInt64),
    relayer Nullable(String),
    denom Nullable(String),
    amount Nullable(Decimal128(0)),
    memo Nullable(String)
)
ENGINE = ReplacingMergeTree
PARTITION BY intDiv(sequence, 1000000)
ORDER BY (channel_id_src, port_id_src, sequence);

CREATE TABLE IF NOT EXISTS ibc.denoms
(
    denom_hash String,
    base_denom String,
    trace_path String
)
ENGINE = ReplacingMergeTree
ORDER BY (denom_hash);

-- ==========================================================================
-- CosmWasm
-- ==========================================================================
CREATE TABLE IF NOT EXISTS wasm.codes
(
    code_id UInt64,
    checksum String,
    creator Nullable(String),
    instantiate_permission Nullable(String),
    store_tx_hash Nullable(String),
    store_height Nullable(UInt64)
)
ENGINE = ReplacingMergeTree
ORDER BY (code_id);

CREATE TABLE IF NOT EXISTS wasm.contracts
(
    address String,
    code_id UInt64,
    creator Nullable(String),
    admin Nullable(String),
    label Nullable(String),
    created_height Nullable(UInt64),
    created_tx_hash Nullable(String)
)
ENGINE = ReplacingMergeTree
ORDER BY (address);

CREATE TABLE IF NOT EXISTS wasm.contract_migrations
(
    contract String,
    from_code_id Nullable(UInt64),
    to_code_id UInt64,
    height UInt64,
    tx_hash String
)
ENGINE = ReplacingMergeTree
PARTITION BY intDiv(height, 1000000)
ORDER BY (contract, height, tx_hash);

CREATE TABLE IF NOT EXISTS wasm.executions
(
    tx_hash String,
    msg_index Int32,
    contract String,
    caller Nullable(String),
    funds Nullable(String),
    msg String,
    success Bool,
    error Nullable(String),
    gas_used Nullable(UInt64),
    height UInt64
)
ENGINE = ReplacingMergeTree
PARTITION BY intDiv(height, 1000000)
ORDER BY (height, tx_hash, msg_index);

CREATE TABLE IF NOT EXISTS wasm.events
(
    contract String,
    height UInt64,
    tx_hash String,
    msg_index Int32,
    event_type String,
    attributes String
)
ENGINE = ReplacingMergeTree
PARTITION BY intDiv(height, 1000000)
ORDER BY (height, tx_hash, msg_index, event_type);

CREATE TABLE IF NOT EXISTS wasm.state_kv
(
    contract String,
    key String,
    key_prefix Nullable(String),
    height UInt64,
    value String
)
ENGINE = ReplacingMergeTree
PARTITION BY intDiv(height, 1000000)
ORDER BY (contract, key, height);

-- ==========================================================================
-- Tokens
-- ==========================================================================
CREATE TABLE IF NOT EXISTS tokens.cw20_transfers
(
    contract String,
    from_addr String,
    to_addr String,
    amount Decimal128(0),
    height UInt64,
    tx_hash String
)
ENGINE = ReplacingMergeTree
PARTITION BY intDiv(height, 1000000)
ORDER BY (height, tx_hash, contract, from_addr, to_addr);

CREATE TABLE IF NOT EXISTS tokens.cw20_balances_current
(
    contract String,
    account String,
    balance Decimal128(0)
)
ENGINE = ReplacingMergeTree
ORDER BY (contract, account);

-- ==========================================================================
-- Authz / Feegrant
-- ==========================================================================
CREATE TABLE IF NOT EXISTS authz_feegrant.authz_grants
(
    granter String,
    grantee String,
    msg_type_url String,
    expiration Nullable(DateTime64(3, 'UTC')),
    height UInt64,
    revoked Bool DEFAULT false
)
ENGINE = ReplacingMergeTree
PARTITION BY intDiv(height, 1000000)
ORDER BY (granter, grantee, msg_type_url, height);

CREATE TABLE IF NOT EXISTS authz_feegrant.fee_grants
(
    granter String,
    grantee String,
    allowance String,
    expiration Nullable(DateTime64(3, 'UTC')),
    height UInt64,
    revoked Bool DEFAULT false
)
ENGINE = ReplacingMergeTree
PARTITION BY intDiv(height, 1000000)
ORDER BY (granter, grantee, height);

-- ==========================================================================
-- Groups / DAO
-- ==========================================================================
CREATE TABLE IF NOT EXISTS groups.groups
(
    group_id UInt64,
    admin String,
    metadata Nullable(String)
)
ENGINE = ReplacingMergeTree
ORDER BY (group_id);

CREATE TABLE IF NOT EXISTS groups.members
(
    group_id UInt64,
    member String,
    weight Decimal(20, 6),
    metadata Nullable(String)
)
ENGINE = ReplacingMergeTree
ORDER BY (group_id, member);

CREATE TABLE IF NOT EXISTS groups.proposals
(
    proposal_id UInt64,
    group_id UInt64,
    proposer String,
    metadata Nullable(String),
    status String,
    submit_time Nullable(DateTime64(3, 'UTC'))
)
ENGINE = ReplacingMergeTree
ORDER BY (proposal_id);

CREATE TABLE IF NOT EXISTS groups.votes
(
    proposal_id UInt64,
    voter String,
    option String,
    weight Nullable(Decimal(20, 18)),
    height UInt64
)
ENGINE = ReplacingMergeTree
ORDER BY (proposal_id, voter, height);

-- ==========================================================================
-- Analytics
-- ==========================================================================
CREATE TABLE IF NOT EXISTS analytics.validator_uptime_daily
(
    day Date,
    operator_address String,
    signed_blocks UInt32,
    missed_blocks UInt32
)
ENGINE = ReplacingMergeTree
PARTITION BY toYear(day)
ORDER BY (day, operator_address);

CREATE TABLE IF NOT EXISTS analytics.msg_gas_profile_daily
(
    day Date,
    type_url String,
    count UInt64,
    gas_used_p50 Nullable(UInt64),
    gas_used_p95 Nullable(UInt64)
)
ENGINE = ReplacingMergeTree
PARTITION BY toYear(day)
ORDER BY (day, type_url);

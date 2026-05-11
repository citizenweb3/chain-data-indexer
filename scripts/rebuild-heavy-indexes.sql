-- Rebuild heavy secondary indexes that can be skipped during fresh bulk backfill.
--
-- Run this only after the backfill window is complete and the indexer is stopped,
-- or before switching the database to read-heavy workloads.

CREATE INDEX IF NOT EXISTS idx_txs_code ON core.transactions (code);
CREATE INDEX IF NOT EXISTS idx_txs_signers_gin ON core.transactions USING GIN (signers);
CREATE INDEX IF NOT EXISTS idx_txs_time ON core.transactions (time DESC);
CREATE INDEX IF NOT EXISTS idx_txs_success ON core.transactions (height DESC, tx_index) WHERE code = 0;
CREATE INDEX IF NOT EXISTS idx_txs_hash ON core.transactions (tx_hash);

CREATE INDEX IF NOT EXISTS idx_msgs_height_type ON core.messages (height DESC, type_url);
CREATE INDEX IF NOT EXISTS idx_msgs_signer ON core.messages (signer, height DESC);
CREATE INDEX IF NOT EXISTS idx_msgs_value_path ON core.messages USING GIN (value jsonb_path_ops);
CREATE INDEX IF NOT EXISTS idx_msgs_txhash_msg ON core.messages (tx_hash, msg_index);

CREATE INDEX IF NOT EXISTS idx_events_type ON core.events (event_type);
CREATE INDEX IF NOT EXISTS idx_event_attrs_key ON core.event_attrs (key);
CREATE INDEX IF NOT EXISTS idx_event_attrs_key_value_md5 ON core.event_attrs (key, md5(COALESCE(value, '')));

CREATE INDEX IF NOT EXISTS idx_transfers_from ON bank.transfers (from_addr, height DESC);
CREATE INDEX IF NOT EXISTS idx_transfers_to ON bank.transfers (to_addr, height DESC);
CREATE INDEX IF NOT EXISTS idx_transfers_denom ON bank.transfers (denom);
CREATE INDEX IF NOT EXISTS idx_transfers_brin_height ON bank.transfers USING BRIN (height);

CREATE INDEX IF NOT EXISTS idx_del_ev_delegator ON stake.delegation_events (delegator_address, height DESC);
CREATE INDEX IF NOT EXISTS idx_del_ev_valdst ON stake.delegation_events (validator_dst, height DESC);
CREATE INDEX IF NOT EXISTS idx_del_ev_valsrc ON stake.delegation_events (validator_src, height DESC);

CREATE INDEX IF NOT EXISTS idx_dist_ev_validator ON stake.distribution_events (validator_address, height DESC);
CREATE INDEX IF NOT EXISTS idx_dist_ev_delegator ON stake.distribution_events (delegator_address, height DESC);

CREATE INDEX IF NOT EXISTS idx_gov_status ON gov.proposals (status);
CREATE INDEX IF NOT EXISTS idx_gov_dep_depositor ON gov.deposits (depositor, height DESC);
CREATE INDEX IF NOT EXISTS idx_gov_votes_voter ON gov.votes (voter, height DESC);
CREATE INDEX IF NOT EXISTS idx_gov_votes_prop ON gov.votes (proposal_id, option);

CREATE INDEX IF NOT EXISTS idx_wasm_exec_contract ON wasm.executions (contract, height DESC);
CREATE INDEX IF NOT EXISTS idx_wasm_exec_msg_gin ON wasm.executions USING GIN (msg jsonb_path_ops);
CREATE INDEX IF NOT EXISTS idx_wasm_exec_success ON wasm.executions (success);
CREATE INDEX IF NOT EXISTS idx_wasm_exec_tx_msg ON wasm.executions (tx_hash, msg_index);

CREATE INDEX IF NOT EXISTS idx_wasm_events_contract ON wasm.events (contract, height DESC);
CREATE INDEX IF NOT EXISTS idx_wasm_events_type ON wasm.events (event_type);
CREATE INDEX IF NOT EXISTS idx_wasm_events_tx_msg ON wasm.events (tx_hash, msg_index);
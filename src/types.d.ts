export type MoneroRpcError = {
  code: number;
  message: string;
};

export interface MoneroJsonRpcEnvelope<T> {
  id: string;
  jsonrpc: '2.0';
  result?: T;
  error?: MoneroRpcError;
}

export interface MoneroBlockHeader {
  block_size: number;
  block_weight: number;
  cumulative_difficulty: number | string;
  cumulative_difficulty_top64: number | string;
  depth: number;
  difficulty: number | string;
  difficulty_top64: number | string;
  hash: string;
  height: number;
  long_term_weight: number;
  major_version: number;
  miner_tx_hash: string;
  minor_version: number;
  nonce: number;
  num_txes: number;
  orphan_status: boolean;
  pow_hash: string;
  prev_hash: string;
  reward: number | string;
  timestamp: number;
  wide_cumulative_difficulty: string;
  wide_difficulty: string;
}

export interface MoneroTxJson {
  version?: number;
  unlock_time?: number;
  vin?: unknown[];
  vout?: unknown[];
  extra?: unknown[];
  signatures?: unknown[];
  rct_signatures?: Record<string, unknown>;
  fee?: number | string;
  [key: string]: unknown;
}

export interface MoneroBlockJson {
  major_version: number;
  minor_version: number;
  timestamp: number;
  prev_id: string;
  nonce: number;
  miner_tx: MoneroTxJson;
  tx_hashes: string[];
  [key: string]: unknown;
}

export interface MoneroGetInfo {
  adjusted_time: number;
  alt_blocks_count: number;
  busy_syncing: boolean;
  database_size: number | string;
  free_space: number | string;
  height: number;
  incoming_connections_count: number;
  mainnet: boolean;
  nettype: 'mainnet' | 'testnet' | 'stagenet';
  offline: boolean;
  outgoing_connections_count: number;
  restricted: boolean;
  rpc_connections_count: number;
  start_time: number;
  status: string;
  synchronized: boolean;
  target: number;
  target_height: number;
  top_block_hash: string;
  tx_count: number;
  tx_pool_size: number;
  untrusted: boolean;
  version: string;
  was_bootstrap_ever_used: boolean;
  [key: string]: unknown;
}

export interface MoneroBlockResponse {
  blob: string;
  block_header: MoneroBlockHeader;
  credits: number;
  json: string;
  miner_tx_hash: string;
  status: string;
  top_hash: string;
  tx_hashes?: string[];
  untrusted: boolean;
}

export interface MoneroPruneStatus {
  pruned: boolean;
  pruning_seed: number;
  status: string;
  untrusted: boolean;
}

export interface MoneroCoinbaseTxSum {
  credits: number;
  emission_amount: number | string;
  emission_amount_top64: number | string;
  fee_amount: number | string;
  fee_amount_top64: number | string;
  status: string;
  top_hash: string;
  untrusted: boolean;
  wide_emission_amount?: string;
  wide_fee_amount?: string;
}

export interface MoneroAlternativeChain {
  block_hash: string;
  block_hashes: string[];
  difficulty: number | string;
  difficulty_top64: number | string;
  height: number;
  length: number;
  main_chain_parent_block: string;
  wide_difficulty: string;
}

export interface MoneroSyncInfo {
  height: number;
  overview: string;
  peers: unknown[];
  status: string;
  target_height?: number;
  next_needed_pruning_seed?: number;
  [key: string]: unknown;
}

export interface MoneroRpcTransaction {
  as_hex: string;
  as_json: string;
  block_height: number;
  block_timestamp: number;
  confirmations: number;
  double_spend_seen: boolean;
  in_pool: boolean;
  output_indices: number[];
  prunable_as_hex: string;
  prunable_hash: string;
  pruned_as_hex: string;
  tx_hash: string;
}

export interface IndexedMoneroBlock {
  block: MoneroBlockResponse;
  parsedBlock: MoneroBlockJson;
  transactions: MoneroRpcTransaction[];
}

export interface BlockRow {
  hash: string;
  prev_hash: string;
  height: number;
  timestamp: number;
  major_version: number;
  minor_version: number;
  nonce: number;
  block_size: number;
  block_weight: number;
  long_term_weight: number;
  num_txes: number;
  miner_tx_hash: string;
  reward_atomic: string;
  difficulty_hex: string;
  cumulative_difficulty_hex: string;
  orphan_status: boolean;
  is_canonical: boolean;
  is_settled: boolean;
  raw: Record<string, unknown>;
  indexed_at: Date;
}

export interface TransactionRow {
  hash: string;
  block_hash: string;
  block_height: number;
  position: number;
  version: number;
  unlock_time: number;
  inputs_count: number;
  outputs_count: number;
  fee_atomic: string | null;
  in_pool: boolean;
  confirmations: number | null;
  raw: Record<string, unknown>;
  indexed_at: Date;
  is_canonical: boolean;
  is_settled: boolean;
}

export interface ProgressRow {
  id: string;
  last_height: number;
  last_hash: string | null;
  updated_at: Date;
}

export interface SupplyCheckpointRow {
  height: number;
  block_hash: string;
  block_timestamp: number;
  cumulative_emission_atomic: string;
  cumulative_fee_atomic: string;
  source_method: string;
  computed_at: Date;
}

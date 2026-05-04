// Logos Blockchain API types — v0.1.2 (testnet)
// Source: https://github.com/logos-blockchain/logos-blockchain

// ─── Consensus / network ──────────────────────────────────────────────────────

export interface CryptarchiaInfo {
  lib: string;        // last irreversible block hash
  lib_slot: number;
  tip: string;        // current chain tip hash
  slot: number;
  height: number;
  mode: 'Online' | 'Bootstrapping';
}

export interface NetworkInfo {
  listen_addresses: string[];
  peer_id: string;
  n_peers: number;
  n_connections: number;
  n_pending_connections: number;
}

// ─── Blocks ───────────────────────────────────────────────────────────────────

export interface ProofOfLeadership {
  proof: number[];              // 128-byte Groth16 proof (raw byte array)
  entropy_contribution: string; // hex
  leader_key: string;           // proof leader/signing key (hex), not a stable validator id in v0.1.2
  voucher_cm: string;           // voucher commitment (hex)
}

export interface BlockHeader {
  id?: string;          // present in /cryptarchia/blocks, absent in /storage/block
  version?: string;     // e.g. "Bedrock"
  parent_block: string; // parent block hash (hex)
  slot: number;
  height?: number | null;
  block_root: string;   // hex
  proof_of_leadership: ProofOfLeadership;
}

export interface LogosBlock {
  header: BlockHeader;
  signature?: number[];     // raw byte array, present in /storage/block
  transactions: LogosTransaction[];
}

export interface MantleTxOp {
  opcode: number;
  payload: unknown;
}

export interface MantleTxBody {
  hash?: string;
  ops?: MantleTxOp[];
  storage_gas_price?: number;
  execution_gas_price?: number;
}

export interface LogosTransaction {
  mantle_tx?: MantleTxBody;
  ops_proofs?: Record<string, unknown>[];
}

// ─── Live block stream event (application/x-ndjson) ───────────────────────────

export interface BlockStreamEvent {
  block: LogosBlock;
  tip: string;
  tip_slot: number;
  lib: string;
  lib_slot: number;
}

// ─── LIB-stream event (application/x-ndjson) ─────────────────────────────────
// Emitted by GET /cryptarchia/lib-stream each time the Last Irreversible Block advances.
// Verified against live testnet node (v0.1.2).

export interface LibStreamEvent {
  height:    number;   // finalized block height
  header_id: string;   // finalized block header id (hex)
}

// ─── Database row shapes (returned from queries) ──────────────────────────────

export interface BlockRow {
  id: string;
  parent_block: string;
  slot: number;
  height: number | null;
  block_root: string;
  leader_key: string;
  voucher_cm: string;
  entropy: string;
  tx_count: number;
  raw: LogosBlock;
  finalized: boolean;
  is_canonical: boolean;
  indexed_at: Date;
}

export interface LeaderRow {
  // Legacy DB row name. Represents proof leader-key diagnostics, not validator identity.
  leader_key: string;
  blocks_produced: number;
  first_block_slot: number | null;
  last_block_slot: number | null;
  updated_at: Date;
}

export interface ProgressRow {
  id: string;
  last_slot: number;
  last_height: number | null;
  updated_at: Date;
}

export interface TransactionRow {
  id: string;
  tx_hash: string | null;
  block_id: string;
  position: number;
  raw: LogosTransaction;
  indexed_at: Date;
}

// ─── v0.2+ types (planned — richer decoding, not raw tx storage) ──────────────
// Raw transactions are already indexed. Richer decoded UTXO/note lifecycle types
// stay deferred until the protocol/API surface is stable.
// Wallet balances per arbitrary address are NOT available in the public API
// (privacy-first design: ZK-notes are only decryptable by the key holder).
// logos_balance_snapshots / logos_watched_addresses are reserved for a future
// version of the API that may expose aggregate/public balance data.

// /src/types.d.ts
export type ArgMap = Record<string, string | boolean>;

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent';
export type PgMode = 'block-atomic' | 'batch-insert';

/**
 * Global application configuration resolved from CLI args, environment variables, and defaults.
 */
export type Config = {
  /** CometBFT RPC endpoint URL (http/https). */
  rpcUrl: string;
  /** Starting block height (inclusive). If omitted and --resume is set, will resume from DB. */
  from?: number | string;
  /** Ending block height (inclusive). If omitted (or set to "latest"), it will be resolved via /status. */
  to?: number;
  /** Total number of shards when running the indexer in parallel. */
  shards: number;
  /** Current shard id in range [0..shards-1]. */
  shardId: number;
  /** Max number of concurrent network requests. */
  concurrency: number;
  /** HTTP request timeout in milliseconds. */
  timeoutMs: number;
  /** Target requests-per-second throttle per process. */
  rps: number;
  /** Retry attempts for transient network failures. */
  retries: number;
  /** Initial backoff (ms) for retries. */
  backoffMs: number;
  /** Jitter factor [0..1] applied to backoff. */
  backoffJitter: number;
  /** Log verbosity level. */
  logLevel: LogLevel;
  /** Output JSON case style for assembled objects. */
  caseMode: 'snake' | 'camel';
  /** Emit progress log every N blocks. */
  progressEveryBlocks: number;
  /** Emit progress log at least every N seconds. */
  progressIntervalSec: number;
  /** Sink type to use. */
  sinkKind: SinkKind;
  /** Output path for file sink. */
  outPath?: string;
  /** Flush frequency for sinks (in blocks). */
  flushEvery?: number;
  /** Resume mode flag; if true, starting height will be resolved from DB progress. */
  resume?: boolean;
  /** First available block height for the chain (fallback if resume has no record). */
  firstBlock?: number;
  /** If true, `to` will be resolved from RPC /status (when user passed `--to=latest`). */
  resolveLatestTo: boolean;

  /** If true, indexer will follow new blocks after reaching the latest height. */
  follow?: boolean;
  /** Polling interval in milliseconds for follow mode. */
  followIntervalMs?: number;

  /** Postgres connection and batching settings (present only for postgres sink). */
  pg?: {
    /** Hostname of the database server. */
    host?: string;
    /** Port number of the database server. */
    port?: number;
    /** Database user. */
    user?: string;
    /** Database password. */
    password?: string;
    /** Database name. */
    database?: string;
    /** Enable SSL if true. */
    ssl?: boolean;
    /** Ingestion mode for Postgres sink. */
    mode?: PgMode;
    /** Batch size for blocks buffer. */
    batchBlocks?: number;
    /** Batch size for transactions buffer. */
    batchTxs?: number;
    /** Batch size for messages buffer. */
    batchMsgs?: number;
    /** Batch size for events buffer. */
    batchEvents?: number;
    /** Batch size for event attributes buffer. */
    batchAttrs?: number;
    /** Maximum number of pooled connections for pg. */
    poolSize?: number;
    /** Custom identifier for tracking progress in the database, used when resuming indexing. */
    progressId?: string;
  };
};

/**
 * Attribute of an ABCI event.
 */
export type AbciEventAttr = {
  /** Attribute key */
  key: string;
  /** Attribute value */
  value: string;
  /** Whether this attribute is indexed (defaults to true if missing) */
  index?: boolean;
};

/**
 * ABCI event containing a type and its attributes.
 */
export type AbciEvent = {
  /** Event type */
  type: string;
  /** Array of event attributes */
  attributes: AbciEventAttr[];
};

/**
 * Result of DeliverTx for a single transaction from /block_results.
 */
export type TxsResult = {
  /** Result code */
  code: number;
  /** Optional code namespace */
  codespace?: string;
  /** Optional data field (base64) */
  data?: string;
  /** Optional log (raw JSON string or other format) */
  log?: string;
  /** Optional transaction-level events */
  events?: AbciEvent[];
  /** Gas wanted */
  gas_wanted?: string;
  /** Gas used */
  gas_used?: string;
};

/**
 * Decoded message with known type and fields.
 */
export type DecodedMsgKnown = {
  /** Protobuf type URL */
  '@type': string;
  /**
   * Additional fields in snake_case as per the specific proto type.
   */
  [k: string]: unknown;
};
/**
 * Decoded message with unknown type, containing base64-encoded value.
 */
export type DecodedMsgUnknown = {
  /** Protobuf type URL */
  '@type': string;
  /** Original Any.value bytes in base64 */
  value_b64: string;
};

/**
 * Decoded message, either known or unknown type.
 */
export type DecodedMsg = DecodedMsgKnown | DecodedMsgUnknown;

/**
 * Decoded transaction (protobuf TxRaw -> Tx).
 */
export type DecodedTx = {
  /** Transaction type */
  '@type': '/cosmos.tx.v1beta1.Tx';
  /** Transaction body */
  body: {
    /** Array of decoded messages */
    messages: DecodedMsg[];
    /** Transaction memo */
    memo: string;
    /** Timeout height */
    timeout_height: string;
    /** Whether transaction is unordered */
    unordered?: boolean;
    /** Optional timeout timestamp */
    timeout_timestamp?: string | null;
    /** Extension options */
    extension_options: unknown[];
    /** Non-critical extension options */
    non_critical_extension_options: unknown[];
  };
  /** Authentication info */
  auth_info: {
    /** Array of signer infos */
    signer_infos: Array<{
      /** Optional public key */
      public_key?: { '@type': '/cosmos.crypto.secp256k1.PubKey'; key: string } | { '@type': string; value: string };
      /** Optional mode info */
      mode_info?: unknown;
      /** Sequence number */
      sequence: string;
    }>;
    /** Fee information */
    fee: {
      /** Array of fee amounts */
      amount: Array<{ denom: string; amount: string }>;
      /** Gas limit */
      gas_limit: string;
      /** Fee payer */
      payer: string;
      /** Fee granter */
      granter: string;
    };
    /** Optional tip */
    tip?: unknown | null;
  };
  /** Array of signatures (base64) */
  signatures: string[];
};

/**
 * Main object representing a block (RPC-only).
 */
export type BlockJson = {
  /** Block meta information */
  meta: {
    /** Chain ID */
    chain_id: string;
    /** Block height */
    height: string;
    /** Block time (ISO-8601) */
    time: string;
  };
  /** Block data */
  block: {
    /** Block ID */
    block_id: unknown;
    /** Block header */
    header: unknown;
    /** Block data containing transactions */
    data: {
      /** Array of transactions (base64) */
      txs_base64: string[];
      /** Optional array of transactions (hex) */
      txs_hex?: string[];
    };
    /** Last commit information */
    last_commit: unknown;
  };
  /** Block results */
  block_results: {
    /** Events at the beginning of the block */
    begin_block_events: AbciEvent[];
    /** Events at the end of the block */
    end_block_events: AbciEvent[];
    /** Results for each transaction */
    txs_results: TxsResult[];
    /** Optional validator updates */
    validator_updates?: unknown[];
    /** Optional consensus parameter updates */
    consensus_param_updates?: unknown;
  };
  /** Array of transaction objects */
  txs: Array<{
    /** Transaction index */
    index: number;
    /** Transaction hash (HEX_UPPER SHA-256(raw)) */
    hash: string;
    /** Raw transaction data in base64 and hex */
    raw: { base64: string; hex: string };
    /** Decoded transaction */
    decoded: DecodedTx;
    /** Transaction response */
    tx_response: {
      /** Block height */
      height: string;
      /** Codespace */
      codespace: string;
      /** Result code */
      code: number;
      /** Data (base64) */
      data: string;
      /** Raw log as is */
      raw_log: string;
      /** Optional logs for each message */
      logs?: Array<{ msg_index: number | null; events: AbciEvent[] }>;
      /** Optional transaction-level events */
      events?: AbciEvent[];
      /** Gas wanted */
      gas_wanted: string;
      /** Gas used */
      gas_used: string;
      /** Timestamp (from meta.time) */
      timestamp: string;
    };
  }>;
  /** Optional validator set */
  validator_set?: {
    /** Proposer address */
    proposer_address: string;
    /** Array of validators */
    validators: unknown[];
  };
};

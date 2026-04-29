/**
 * RPC-layer types for miden-node v0.13.4.
 *
 * @grpc/proto-loader is loaded with keepCase: false, so proto snake_case fields
 * are represented here in lowerCamelCase (for example block_num -> blockNum).
 * Digest messages are exposed as 32-byte Buffers and AccountId messages as
 * 15-byte Buffers; conversion to/from the proto felt tuple/bytes wrapper is
 * handled by src/rpc/digest.ts and src/rpc/client.ts.
 */

export type Digest = Buffer;
export type AccountId = Buffer;
export type UInt64String = string;

export interface MidenRpcClientConfig {
  url: string;
  requestTimeoutMs: number;
  maxReceiveMessageLength?: number;
}

export interface RpcStatus {
  version: string;
  genesisCommitment: Digest;
  store?: StoreStatus;
  blockProducer?: BlockProducerStatus;
}

export interface StoreStatus {
  version: string;
  status: string;
  chainTip: number;
}

export interface BlockProducerStatus {
  version: string;
  status: string;
  chainTip: number;
  mempoolStats?: MempoolStats;
}

export interface MempoolStats {
  unbatchedTransactions: UInt64String;
  proposedBatches: UInt64String;
  provenBatches: UInt64String;
}

export interface RpcLimits {
  endpoints: Record<string, EndpointLimits>;
}

export interface EndpointLimits {
  parameters: Record<string, number>;
}

export interface BlockNumber {
  blockNum: number;
}

export interface MaybeBlock {
  block?: Buffer;
}

export interface BlockHeaderByNumberRequest {
  blockNum?: number;
  includeMmrProof?: boolean;
}

export interface BlockHeaderByNumberResponse {
  blockHeader?: BlockHeader;
  mmrPath?: MerklePath;
  chainLength?: number;
}

export interface BlockHeader {
  version: number;
  prevBlockCommitment: Digest;
  blockNum: number;
  chainCommitment: Digest;
  accountRoot: Digest;
  nullifierRoot: Digest;
  noteRoot: Digest;
  txCommitment: Digest;
  validatorKey?: ValidatorPublicKey;
  txKernelCommitment: Digest;
  feeParameters?: FeeParameters;
  timestamp: number;
}

export interface ValidatorPublicKey {
  validatorKey: Buffer;
}

export interface FeeParameters {
  nativeAssetId: AccountId;
  verificationBaseFee: number;
}

export interface MerklePath {
  siblings: Digest[];
}

export interface MmrDelta {
  forest: UInt64String;
  data: Digest[];
}

export interface SparseMerklePath {
  emptyNodesMask: UInt64String;
  siblings: Digest[];
}

export type SmtLeaf =
  | { emptyLeafIndex: UInt64String; single?: never; multiple?: never }
  | { emptyLeafIndex?: never; single: SmtLeafEntry; multiple?: never }
  | { emptyLeafIndex?: never; single?: never; multiple: SmtLeafEntryList }
  | { emptyLeafIndex?: never; single?: never; multiple?: never };

export interface SmtLeafEntry {
  key: Digest;
  value: Digest;
}

export interface SmtLeafEntryList {
  entries: SmtLeafEntry[];
}

export interface SmtOpening {
  path?: SparseMerklePath;
  leaf?: SmtLeaf;
}

export interface AccountSummary {
  accountId: AccountId;
  accountCommitment: Digest;
  blockNum: number;
}

export interface AccountWitness {
  accountId: AccountId;
  witnessId: AccountId;
  commitment: Digest;
  path?: SparseMerklePath;
}

export interface AccountHeader {
  accountId: AccountId;
  vaultRoot: Digest;
  storageCommitment: Digest;
  codeCommitment: Digest;
  nonce: UInt64String;
}

export interface AccountStorageHeader {
  slots: StorageSlot[];
}

export interface StorageSlot {
  slotName: string;
  slotType: number;
  commitment: Digest;
}

export interface AccountRequest {
  accountId: AccountId;
  blockNum?: number;
  details?: AccountDetailRequest;
}

export interface AccountDetailRequest {
  codeCommitment?: Digest;
  assetVaultCommitment?: Digest;
  storageMaps?: StorageMapDetailRequest[];
}

export interface StorageMapDetailRequest {
  slotName: string;
  allEntries?: boolean;
  mapKeys?: Digest[];
}

export interface AccountResponse {
  blockNum?: BlockNumber;
  witness?: AccountWitness;
  details?: AccountDetails;
}

export interface AccountDetails {
  header?: AccountHeader;
  storageDetails?: AccountStorageDetails;
  code?: Buffer;
  vaultDetails?: AccountVaultDetails;
}

export interface AccountStorageDetails {
  header?: AccountStorageHeader;
  mapDetails: AccountStorageMapDetails[];
}

export interface AccountStorageMapDetails {
  slotName: string;
  tooManyEntries: boolean;
  allEntries?: AllMapEntries;
  entriesWithProofs?: MapEntriesWithProofs;
}

export interface AllMapEntries {
  entries: StorageMapEntry[];
}

export interface StorageMapEntry {
  key: Digest;
  value: Digest;
}

export interface MapEntriesWithProofs {
  entries: StorageMapEntryWithProof[];
}

export interface StorageMapEntryWithProof {
  key: Digest;
  value: Digest;
  proof?: SmtOpening;
}

export interface AccountVaultDetails {
  tooManyAssets: boolean;
  assets: Asset[];
}

export interface Asset {
  asset: Digest;
}

export interface CheckNullifiersResponse {
  proofs: SmtOpening[];
}

export interface NoteMetadata {
  sender: AccountId;
  noteType: number;
  tag: number;
  attachment: Buffer;
}

export interface Note {
  metadata?: NoteMetadata;
  details?: Buffer;
}

export interface NoteInclusionInBlockProof {
  noteId: Digest;
  blockNum: number;
  noteIndexInBlock: number;
  inclusionPath?: SparseMerklePath;
}

export interface CommittedNote {
  note?: Note;
  inclusionProof?: NoteInclusionInBlockProof;
}

export interface CommittedNoteList {
  notes: CommittedNote[];
}

export interface NoteScript {
  entrypoint: number;
  mast: Buffer;
}

export interface MaybeNoteScript {
  script?: NoteScript;
}

export interface NoteSyncRecord {
  noteId: Digest;
  noteIndexInBlock: number;
  metadata?: NoteMetadata;
  inclusionPath?: SparseMerklePath;
}

export interface TransactionId {
  id: Digest;
}

export interface TransactionSummary {
  transactionId?: TransactionId;
  blockNum: number;
  accountId: AccountId;
}

export interface TransactionHeader {
  accountId: AccountId;
  initialStateCommitment: Digest;
  finalStateCommitment: Digest;
  nullifiers: Digest[];
  outputNotes: NoteSyncRecord[];
}

export interface SyncStateResponse {
  chainTip: number;
  blockHeader?: BlockHeader;
  mmrDelta?: MmrDelta;
  accounts: AccountSummary[];
  transactions: TransactionSummary[];
  notes: NoteSyncRecord[];
}

export interface BlockRange {
  blockFrom: number;
  blockTo?: number;
}

export interface PaginationInfo {
  chainTip: number;
  blockNum: number;
}

export interface SyncNullifiersRequest {
  blockRange: BlockRange;
  prefixLen: number;
  nullifiers: number[];
}

export interface NullifierUpdate {
  nullifier: Digest;
  blockNum: number;
}

export interface SyncNullifiersResponse {
  paginationInfo?: PaginationInfo;
  nullifiers: NullifierUpdate[];
}

export interface SyncAccountVaultRequest {
  blockRange: BlockRange;
  accountId: AccountId;
}

export interface AccountVaultUpdate {
  vaultKey: Digest;
  asset?: Asset;
  blockNum: number;
}

export interface SyncAccountVaultResponse {
  paginationInfo?: PaginationInfo;
  updates: AccountVaultUpdate[];
}

export interface SyncNotesRequest {
  blockRange: BlockRange;
  noteTags: number[];
}

export interface SyncNotesResponse {
  paginationInfo?: PaginationInfo;
  blockHeader?: BlockHeader;
  mmrPath?: MerklePath;
  notes: NoteSyncRecord[];
}

export interface SyncAccountStorageMapsRequest {
  blockRange: BlockRange;
  accountId: AccountId;
}

export interface StorageMapUpdate {
  blockNum: number;
  slotName: string;
  key: Digest;
  value: Digest;
}

export interface SyncAccountStorageMapsResponse {
  paginationInfo?: PaginationInfo;
  updates: StorageMapUpdate[];
}

export interface SyncTransactionsRequest {
  blockRange: BlockRange;
  accountIds: AccountId[];
}

export interface TransactionRecord {
  blockNum: number;
  header?: TransactionHeader;
}

export interface SyncTransactionsResponse {
  paginationInfo?: PaginationInfo;
  transactions: TransactionRecord[];
}

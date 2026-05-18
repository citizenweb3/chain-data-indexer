import * as grpc from '@grpc/grpc-js';
import { observeRpc, type RpcStatusLabel } from '../metrics/registry.js';
import { logger } from '../utils/logger.js';
import { RateLimitError, withRetry } from '../utils/retry.js';
import { digestFromFelts, wireDigestFromBuffer } from './digest.js';
import { getApiServiceConstructor } from './protoLoader.js';
import type {
  AccountDetailRequest,
  AccountHeader,
  AccountId,
  AccountRequest,
  AccountResponse,
  AccountStorageDetails,
  AccountStorageHeader,
  AccountStorageMapDetails,
  AccountSummary,
  AccountVaultDetails,
  AccountVaultUpdate,
  AccountWitness,
  AllMapEntries,
  Asset,
  BlockHeader,
  BlockHeaderByNumberResponse,
  BlockNumber,
  BlockProducerStatus,
  BlockRange,
  CheckNullifiersResponse,
  CommittedNote,
  CommittedNoteList,
  EndpointLimits,
  FeeParameters,
  MapEntriesWithProofs,
  MaybeBlock,
  MaybeNoteScript,
  MempoolStats,
  MerklePath,
  MidenRpcClientConfig,
  MmrDelta,
  Note,
  NoteInclusionInBlockProof,
  NoteMetadata,
  NoteScript,
  NoteSyncRecord,
  PaginationInfo,
  RpcLimits,
  RpcStatus,
  SmtLeaf,
  SmtLeafEntry,
  SmtLeafEntryList,
  SmtOpening,
  SparseMerklePath,
  StorageMapEntry,
  StorageMapEntryWithProof,
  StorageMapUpdate,
  StorageSlot,
  SyncAccountStorageMapsRequest,
  SyncAccountStorageMapsResponse,
  SyncAccountVaultRequest,
  SyncAccountVaultResponse,
  SyncNotesRequest,
  SyncNotesResponse,
  SyncNullifiersRequest,
  SyncNullifiersResponse,
  SyncStateResponse,
  SyncTransactionsRequest,
  SyncTransactionsResponse,
  TransactionHeader,
  TransactionId,
  TransactionRecord,
  TransactionSummary,
  ValidatorPublicKey,
} from './types.js';

const DEFAULT_MAX_RECEIVE_MESSAGE_LENGTH = 64 * 1024 * 1024;
const RETRY_ATTEMPTS = 8;
const RETRY_BASE_MS = 250;
const RETRYABLE_GRPC_CODES = new Set<grpc.status>([
  grpc.status.UNAVAILABLE,
  grpc.status.DEADLINE_EXCEEDED,
  grpc.status.INTERNAL,
  grpc.status.RESOURCE_EXHAUSTED,
]);

interface UnaryRpcMethod {
  (request: unknown, metadata: grpc.Metadata, options: grpc.CallOptions, callback: (error: grpc.ServiceError | null, response: unknown) => void): grpc.ClientUnaryCall;
}

type WireRecord = Record<string, unknown>;

class RetryableGrpcError extends Error {
  readonly status = 503;

  constructor(readonly grpcError: grpc.ServiceError) {
    super(grpcError.message);
    this.name = 'RetryableGrpcError';
  }
}

/** Parse "Wait for Ns" hint from a RESOURCE_EXHAUSTED message, returns ms. */
function parseRateLimitHint(message: string): number {
  const match = /wait for (\d+(?:\.\d+)?)s/i.exec(message);
  return match ? Math.round(parseFloat(match[1]!) * 1_000) : 0;
}

function asRecord(value: unknown): WireRecord {
  if (!value || typeof value !== 'object') return {};
  return value as WireRecord;
}

function optionalRecord(value: unknown): WireRecord | undefined {
  if (!value || typeof value !== 'object') return undefined;
  return value as WireRecord;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return value.toString();
  return fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.length > 0) return Number(value);
  if (typeof value === 'bigint') return Number(value);
  return fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asBuffer(value: unknown): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.alloc(0);
}

function digestFromWire(value: unknown): Buffer {
  const record = asRecord(value);
  return digestFromFelts([
    asString(record.d0, '0'),
    asString(record.d1, '0'),
    asString(record.d2, '0'),
    asString(record.d3, '0'),
  ]);
}

function accountIdFromWire(value: unknown): Buffer {
  return asBuffer(asRecord(value).id);
}

function accountIdToWire(accountId: AccountId): WireRecord {
  return { id: accountId };
}

function digestToWire(digest: Buffer): WireRecord {
  return wireDigestFromBuffer(digest);
}

function blockRangeToWire(blockRange: BlockRange): WireRecord {
  return {
    blockFrom: blockRange.blockFrom,
    ...(blockRange.blockTo === undefined ? {} : { blockTo: blockRange.blockTo }),
  };
}

function merklePathFromWire(value: unknown): MerklePath | undefined {
  const record = optionalRecord(value);
  if (!record) return undefined;
  return { siblings: asArray(record.siblings).map(digestFromWire) };
}

function sparseMerklePathFromWire(value: unknown): SparseMerklePath | undefined {
  const record = optionalRecord(value);
  if (!record) return undefined;
  return {
    emptyNodesMask: asString(record.emptyNodesMask, '0'),
    siblings: asArray(record.siblings).map(digestFromWire),
  };
}

function smtLeafEntryFromWire(value: unknown): SmtLeafEntry {
  const record = asRecord(value);
  return { key: digestFromWire(record.key), value: digestFromWire(record.value) };
}

function smtLeafEntryListFromWire(value: unknown): SmtLeafEntryList {
  return { entries: asArray(asRecord(value).entries).map(smtLeafEntryFromWire) };
}

function smtLeafFromWire(value: unknown): SmtLeaf | undefined {
  const record = optionalRecord(value);
  if (!record) return undefined;
  if ('emptyLeafIndex' in record) return { emptyLeafIndex: asString(record.emptyLeafIndex, '0') };
  if ('single' in record) return { single: smtLeafEntryFromWire(record.single) };
  if ('multiple' in record) return { multiple: smtLeafEntryListFromWire(record.multiple) };
  return {};
}

function smtOpeningFromWire(value: unknown): SmtOpening {
  const record = asRecord(value);
  return { path: sparseMerklePathFromWire(record.path), leaf: smtLeafFromWire(record.leaf) };
}

function validatorPublicKeyFromWire(value: unknown): ValidatorPublicKey | undefined {
  const record = optionalRecord(value);
  return record ? { validatorKey: asBuffer(record.validatorKey) } : undefined;
}

function feeParametersFromWire(value: unknown): FeeParameters | undefined {
  const record = optionalRecord(value);
  if (!record) return undefined;
  return {
    nativeAssetId: accountIdFromWire(record.nativeAssetId),
    verificationBaseFee: asNumber(record.verificationBaseFee),
  };
}

function blockHeaderFromWire(value: unknown): BlockHeader | undefined {
  const record = optionalRecord(value);
  if (!record) return undefined;
  return {
    version: asNumber(record.version),
    prevBlockCommitment: digestFromWire(record.prevBlockCommitment),
    blockNum: asNumber(record.blockNum),
    chainCommitment: digestFromWire(record.chainCommitment),
    accountRoot: digestFromWire(record.accountRoot),
    nullifierRoot: digestFromWire(record.nullifierRoot),
    noteRoot: digestFromWire(record.noteRoot),
    txCommitment: digestFromWire(record.txCommitment),
    validatorKey: validatorPublicKeyFromWire(record.validatorKey),
    txKernelCommitment: digestFromWire(record.txKernelCommitment),
    feeParameters: feeParametersFromWire(record.feeParameters),
    timestamp: asNumber(record.timestamp),
  };
}

function mempoolStatsFromWire(value: unknown): MempoolStats | undefined {
  const record = optionalRecord(value);
  if (!record) return undefined;
  return {
    unbatchedTransactions: asString(record.unbatchedTransactions, '0'),
    proposedBatches: asString(record.proposedBatches, '0'),
    provenBatches: asString(record.provenBatches, '0'),
  };
}

function storeStatusFromWire(value: unknown): { version: string; status: string; chainTip: number } | undefined {
  const record = optionalRecord(value);
  if (!record) return undefined;
  return { version: asString(record.version), status: asString(record.status), chainTip: asNumber(record.chainTip) };
}

function blockProducerStatusFromWire(value: unknown): BlockProducerStatus | undefined {
  const record = optionalRecord(value);
  if (!record) return undefined;
  return {
    version: asString(record.version),
    status: asString(record.status),
    chainTip: asNumber(record.chainTip),
    mempoolStats: mempoolStatsFromWire(record.mempoolStats),
  };
}

function rpcStatusFromWire(value: unknown): RpcStatus {
  const record = asRecord(value);
  return {
    version: asString(record.version),
    genesisCommitment: digestFromWire(record.genesisCommitment),
    store: storeStatusFromWire(record.store),
    blockProducer: blockProducerStatusFromWire(record.blockProducer),
  };
}

function endpointLimitsFromWire(value: unknown): EndpointLimits {
  const parametersRecord = asRecord(asRecord(value).parameters);
  const parameters = Object.fromEntries(Object.entries(parametersRecord).map(([key, limit]) => [key, asNumber(limit)]));
  return { parameters };
}

function rpcLimitsFromWire(value: unknown): RpcLimits {
  const endpointsRecord = asRecord(asRecord(value).endpoints);
  const endpoints = Object.fromEntries(Object.entries(endpointsRecord).map(([key, limits]) => [key, endpointLimitsFromWire(limits)]));
  return { endpoints };
}

function blockHeaderByNumberResponseFromWire(value: unknown): BlockHeaderByNumberResponse {
  const record = asRecord(value);
  return {
    blockHeader: blockHeaderFromWire(record.blockHeader),
    mmrPath: merklePathFromWire(record.mmrPath),
    chainLength: record.chainLength === undefined ? undefined : asNumber(record.chainLength),
  };
}

function maybeBlockFromWire(value: unknown): MaybeBlock {
  const record = asRecord(value);
  return { block: record.block === undefined ? undefined : asBuffer(record.block) };
}

function blockNumberFromWire(value: unknown): BlockNumber | undefined {
  const record = optionalRecord(value);
  return record ? { blockNum: asNumber(record.blockNum) } : undefined;
}

function storageSlotFromWire(value: unknown): StorageSlot {
  const record = asRecord(value);
  return { slotName: asString(record.slotName), slotType: asNumber(record.slotType), commitment: digestFromWire(record.commitment) };
}

function accountStorageHeaderFromWire(value: unknown): AccountStorageHeader | undefined {
  const record = optionalRecord(value);
  return record ? { slots: asArray(record.slots).map(storageSlotFromWire) } : undefined;
}

function accountHeaderFromWire(value: unknown): AccountHeader | undefined {
  const record = optionalRecord(value);
  if (!record) return undefined;
  return {
    accountId: accountIdFromWire(record.accountId),
    vaultRoot: digestFromWire(record.vaultRoot),
    storageCommitment: digestFromWire(record.storageCommitment),
    codeCommitment: digestFromWire(record.codeCommitment),
    nonce: asString(record.nonce, '0'),
  };
}

function accountWitnessFromWire(value: unknown): AccountWitness | undefined {
  const record = optionalRecord(value);
  if (!record) return undefined;
  return {
    accountId: accountIdFromWire(record.accountId),
    witnessId: accountIdFromWire(record.witnessId),
    commitment: digestFromWire(record.commitment),
    path: sparseMerklePathFromWire(record.path),
  };
}

function assetFromWire(value: unknown): Asset {
  return { asset: digestFromWire(asRecord(value).asset) };
}

function storageMapEntryFromWire(value: unknown): StorageMapEntry {
  const record = asRecord(value);
  return { key: digestFromWire(record.key), value: digestFromWire(record.value) };
}

function storageMapEntryWithProofFromWire(value: unknown): StorageMapEntryWithProof {
  const record = asRecord(value);
  return { key: digestFromWire(record.key), value: digestFromWire(record.value), proof: record.proof ? smtOpeningFromWire(record.proof) : undefined };
}

function allMapEntriesFromWire(value: unknown): AllMapEntries | undefined {
  const record = optionalRecord(value);
  return record ? { entries: asArray(record.entries).map(storageMapEntryFromWire) } : undefined;
}

function mapEntriesWithProofsFromWire(value: unknown): MapEntriesWithProofs | undefined {
  const record = optionalRecord(value);
  return record ? { entries: asArray(record.entries).map(storageMapEntryWithProofFromWire) } : undefined;
}

function accountStorageMapDetailsFromWire(value: unknown): AccountStorageMapDetails {
  const record = asRecord(value);
  return {
    slotName: asString(record.slotName),
    tooManyEntries: asBoolean(record.tooManyEntries),
    allEntries: allMapEntriesFromWire(record.allEntries),
    entriesWithProofs: mapEntriesWithProofsFromWire(record.entriesWithProofs),
  };
}

function accountStorageDetailsFromWire(value: unknown): AccountStorageDetails | undefined {
  const record = optionalRecord(value);
  if (!record) return undefined;
  return { header: accountStorageHeaderFromWire(record.header), mapDetails: asArray(record.mapDetails).map(accountStorageMapDetailsFromWire) };
}

function accountVaultDetailsFromWire(value: unknown): AccountVaultDetails | undefined {
  const record = optionalRecord(value);
  if (!record) return undefined;
  return { tooManyAssets: asBoolean(record.tooManyAssets), assets: asArray(record.assets).map(assetFromWire) };
}

function accountDetailsFromWire(value: unknown) {
  const record = optionalRecord(value);
  if (!record) return undefined;
  return {
    header: accountHeaderFromWire(record.header),
    storageDetails: accountStorageDetailsFromWire(record.storageDetails),
    code: record.code === undefined ? undefined : asBuffer(record.code),
    vaultDetails: accountVaultDetailsFromWire(record.vaultDetails),
  };
}

function accountResponseFromWire(value: unknown): AccountResponse {
  const record = asRecord(value);
  return { blockNum: blockNumberFromWire(record.blockNum), witness: accountWitnessFromWire(record.witness), details: accountDetailsFromWire(record.details) };
}

function checkNullifiersResponseFromWire(value: unknown): CheckNullifiersResponse {
  return { proofs: asArray(asRecord(value).proofs).map(smtOpeningFromWire) };
}

function noteMetadataFromWire(value: unknown): NoteMetadata | undefined {
  const record = optionalRecord(value);
  if (!record) return undefined;
  return {
    sender: accountIdFromWire(record.sender),
    noteType: asNumber(record.noteType),
    tag: asNumber(record.tag),
    attachment: asBuffer(record.attachment),
  };
}

function noteFromWire(value: unknown): Note | undefined {
  const record = optionalRecord(value);
  if (!record) return undefined;
  return { metadata: noteMetadataFromWire(record.metadata), details: record.details === undefined ? undefined : asBuffer(record.details) };
}

function noteInclusionProofFromWire(value: unknown): NoteInclusionInBlockProof | undefined {
  const record = optionalRecord(value);
  if (!record) return undefined;
  return {
    noteId: digestFromWire(asRecord(record.noteId).id),
    blockNum: asNumber(record.blockNum),
    noteIndexInBlock: asNumber(record.noteIndexInBlock),
    inclusionPath: sparseMerklePathFromWire(record.inclusionPath),
  };
}

function committedNoteFromWire(value: unknown): CommittedNote {
  const record = asRecord(value);
  return { note: noteFromWire(record.note), inclusionProof: noteInclusionProofFromWire(record.inclusionProof) };
}

function committedNoteListFromWire(value: unknown): CommittedNoteList {
  return { notes: asArray(asRecord(value).notes).map(committedNoteFromWire) };
}

function noteScriptFromWire(value: unknown): NoteScript | undefined {
  const record = optionalRecord(value);
  return record ? { entrypoint: asNumber(record.entrypoint), mast: asBuffer(record.mast) } : undefined;
}

function maybeNoteScriptFromWire(value: unknown): MaybeNoteScript {
  return { script: noteScriptFromWire(asRecord(value).script) };
}

function noteSyncRecordFromWire(value: unknown): NoteSyncRecord {
  const record = asRecord(value);
  return {
    noteId: digestFromWire(asRecord(record.noteId).id),
    noteIndexInBlock: asNumber(record.noteIndexInBlock),
    metadata: noteMetadataFromWire(record.metadata),
    inclusionPath: sparseMerklePathFromWire(record.inclusionPath),
  };
}

function transactionIdFromWire(value: unknown): TransactionId | undefined {
  const record = optionalRecord(value);
  return record ? { id: digestFromWire(record.id) } : undefined;
}

function transactionSummaryFromWire(value: unknown): TransactionSummary {
  const record = asRecord(value);
  return { transactionId: transactionIdFromWire(record.transactionId), blockNum: asNumber(record.blockNum), accountId: accountIdFromWire(record.accountId) };
}

function syncStateResponseFromWire(value: unknown): SyncStateResponse {
  const record = asRecord(value);
  return {
    chainTip: asNumber(record.chainTip),
    blockHeader: blockHeaderFromWire(record.blockHeader),
    mmrDelta: mmrDeltaFromWire(record.mmrDelta),
    accounts: asArray(record.accounts).map(accountSummaryFromWire),
    transactions: asArray(record.transactions).map(transactionSummaryFromWire),
    notes: asArray(record.notes).map(noteSyncRecordFromWire),
  };
}

function mmrDeltaFromWire(value: unknown): MmrDelta | undefined {
  const record = optionalRecord(value);
  return record ? { forest: asString(record.forest, '0'), data: asArray(record.data).map(digestFromWire) } : undefined;
}

function accountSummaryFromWire(value: unknown): AccountSummary {
  const record = asRecord(value);
  return { accountId: accountIdFromWire(record.accountId), accountCommitment: digestFromWire(record.accountCommitment), blockNum: asNumber(record.blockNum) };
}

function paginationInfoFromWire(value: unknown): PaginationInfo | undefined {
  const record = optionalRecord(value);
  return record ? { chainTip: asNumber(record.chainTip), blockNum: asNumber(record.blockNum) } : undefined;
}

function syncNullifiersResponseFromWire(value: unknown): SyncNullifiersResponse {
  const record = asRecord(value);
  return {
    paginationInfo: paginationInfoFromWire(record.paginationInfo),
    nullifiers: asArray(record.nullifiers).map((entry) => {
      const update = asRecord(entry);
      return { nullifier: digestFromWire(update.nullifier), blockNum: asNumber(update.blockNum) };
    }),
  };
}

function accountVaultUpdateFromWire(value: unknown): AccountVaultUpdate {
  const record = asRecord(value);
  return { vaultKey: digestFromWire(record.vaultKey), asset: record.asset ? assetFromWire(record.asset) : undefined, blockNum: asNumber(record.blockNum) };
}

function syncAccountVaultResponseFromWire(value: unknown): SyncAccountVaultResponse {
  const record = asRecord(value);
  return { paginationInfo: paginationInfoFromWire(record.paginationInfo), updates: asArray(record.updates).map(accountVaultUpdateFromWire) };
}

function syncNotesResponseFromWire(value: unknown): SyncNotesResponse {
  const record = asRecord(value);
  return {
    paginationInfo: paginationInfoFromWire(record.paginationInfo),
    blockHeader: blockHeaderFromWire(record.blockHeader),
    mmrPath: merklePathFromWire(record.mmrPath),
    notes: asArray(record.notes).map(noteSyncRecordFromWire),
  };
}

function storageMapUpdateFromWire(value: unknown): StorageMapUpdate {
  const record = asRecord(value);
  return { blockNum: asNumber(record.blockNum), slotName: asString(record.slotName), key: digestFromWire(record.key), value: digestFromWire(record.value) };
}

function syncAccountStorageMapsResponseFromWire(value: unknown): SyncAccountStorageMapsResponse {
  const record = asRecord(value);
  return { paginationInfo: paginationInfoFromWire(record.paginationInfo), updates: asArray(record.updates).map(storageMapUpdateFromWire) };
}

function transactionHeaderFromWire(value: unknown): TransactionHeader | undefined {
  const record = optionalRecord(value);
  if (!record) return undefined;
  return {
    accountId: accountIdFromWire(record.accountId),
    initialStateCommitment: digestFromWire(record.initialStateCommitment),
    finalStateCommitment: digestFromWire(record.finalStateCommitment),
    nullifiers: asArray(record.nullifiers).map(digestFromWire),
    outputNotes: asArray(record.outputNotes).map(noteSyncRecordFromWire),
  };
}

function transactionRecordFromWire(value: unknown): TransactionRecord {
  const record = asRecord(value);
  return { blockNum: asNumber(record.blockNum), header: transactionHeaderFromWire(record.header) };
}

function syncTransactionsResponseFromWire(value: unknown): SyncTransactionsResponse {
  const record = asRecord(value);
  return { paginationInfo: paginationInfoFromWire(record.paginationInfo), transactions: asArray(record.transactions).map(transactionRecordFromWire) };
}

function accountDetailRequestToWire(details: AccountDetailRequest): WireRecord {
  return {
    ...(details.codeCommitment ? { codeCommitment: digestToWire(details.codeCommitment) } : {}),
    ...(details.assetVaultCommitment ? { assetVaultCommitment: digestToWire(details.assetVaultCommitment) } : {}),
    storageMaps: (details.storageMaps ?? []).map((storageMap) => ({
      slotName: storageMap.slotName,
      ...(storageMap.allEntries === undefined ? {} : { allEntries: storageMap.allEntries }),
      ...(storageMap.mapKeys === undefined ? {} : { mapKeys: { mapKeys: storageMap.mapKeys.map(digestToWire) } }),
    })),
  };
}

function accountRequestToWire(accountId: AccountId, request?: Omit<AccountRequest, 'accountId'>): WireRecord {
  return {
    accountId: accountIdToWire(accountId),
    ...(request?.blockNum === undefined ? {} : { blockNum: { blockNum: request.blockNum } }),
    ...(request?.details === undefined ? {} : { details: accountDetailRequestToWire(request.details) }),
  };
}

function serviceErrorFromUnknown(error: unknown): grpc.ServiceError {
  return error as grpc.ServiceError;
}

function getGrpcCode(error: unknown): grpc.status | undefined {
  const maybeCode = asRecord(error).code;
  return typeof maybeCode === 'number' ? maybeCode : undefined;
}

function getGrpcMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unwrapRetryable(error: unknown): unknown {
  return error instanceof RetryableGrpcError ? error.grpcError : error;
}

function isRetryableGrpcError(error: grpc.ServiceError): boolean {
  return RETRYABLE_GRPC_CODES.has(error.code);
}

function credentialsForUrl(url: string): grpc.ChannelCredentials {
  if (url.startsWith('https://')) return grpc.credentials.createSsl();
  return grpc.credentials.createInsecure();
}

function targetForUrl(url: string): string {
  if (!url.includes('://')) return url;
  const parsed = new URL(url);
  return parsed.host;
}

function methodCandidates(method: string): string[] {
  return [method, `${method[0]?.toLowerCase() ?? ''}${method.slice(1)}`];
}

export class MidenRpcClient {
  private readonly client: grpc.Client;
  private readonly requestTimeoutMs: number;

  constructor(config: MidenRpcClientConfig) {
    this.requestTimeoutMs = config.requestTimeoutMs;
    const ApiService = getApiServiceConstructor();
    const target = targetForUrl(config.url);
    this.client = new ApiService(target, credentialsForUrl(config.url), {
      'grpc.max_receive_message_length': config.maxReceiveMessageLength ?? DEFAULT_MAX_RECEIVE_MESSAGE_LENGTH,
    });
    logger.info('Miden gRPC client configured', {
      target,
      transport: config.url.startsWith('https://') ? 'tls' : 'insecure',
      request_timeout_ms: config.requestTimeoutMs,
    });
  }

  close(): void {
    this.client.close();
  }

  private getMethod(method: string): UnaryRpcMethod {
    const clientRecord = this.client as unknown as Record<string, unknown>;
    for (const candidate of methodCandidates(method)) {
      const rpcMethod = clientRecord[candidate];
      if (typeof rpcMethod === 'function') {
        return rpcMethod.bind(this.client) as UnaryRpcMethod;
      }
    }
    throw new Error(`RPC method ${method} is not available on loaded client`);
  }

  private async callRpc<T>(method: string, request: WireRecord, decode: (response: unknown) => T): Promise<T> {
    let attempt = 0;
    const endpointLabel = method.charAt(0).toLowerCase() + method.slice(1);
    try {
      const response = await withRetry(async () => {
        attempt += 1;
        logger.debug('Miden RPC call attempt', { method, attempt });
        const attemptStart = process.hrtime.bigint();
        let attemptStatus: RpcStatusLabel = 'ok';
        try {
          const raw = await new Promise<unknown>((resolve, reject) => {
            this.getMethod(method)(
              request,
              new grpc.Metadata(),
              { deadline: new Date(Date.now() + this.requestTimeoutMs) },
              (error, value) => {
                if (error) reject(error);
                else resolve(value);
              },
            );
          }).catch((error: unknown) => {
            const grpcError = serviceErrorFromUnknown(error);
            attemptStatus = grpcError.code === grpc.status.DEADLINE_EXCEEDED ? 'timeout' : 'error';
            if (grpcError.code === grpc.status.RESOURCE_EXHAUSTED) {
              throw new RateLimitError(parseRateLimitHint(grpcError.message));
            }
            if (isRetryableGrpcError(grpcError)) {
              if (grpcError.code === grpc.status.INTERNAL) {
                logger.warn('Retrying INTERNAL gRPC error from Miden RPC', { method, message: grpcError.message });
              }
              throw new RetryableGrpcError(grpcError);
            }
            throw grpcError;
          });
          return raw;
        } finally {
          const durationSec = Number(process.hrtime.bigint() - attemptStart) / 1e9;
          observeRpc(endpointLabel, attemptStatus, durationSec);
        }
      }, RETRY_ATTEMPTS, RETRY_BASE_MS);
      return decode(response);
    } catch (error) {
      const finalError = unwrapRetryable(error);
      logger.error('Miden RPC call failed', { method, code: getGrpcCode(finalError), message: getGrpcMessage(finalError) });
      throw finalError;
    }
  }

  async status(): Promise<RpcStatus> {
    return this.callRpc('Status', {}, rpcStatusFromWire);
  }

  async getLimits(): Promise<RpcLimits> {
    return this.callRpc('GetLimits', {}, rpcLimitsFromWire);
  }

  async getBlockHeaderByNumber(blockNum: number | 'latest' = 'latest', includeMmrProof = false): Promise<BlockHeaderByNumberResponse> {
    const request = blockNum === 'latest' ? { includeMmrProof } : { blockNum, includeMmrProof };
    return this.callRpc('GetBlockHeaderByNumber', request, blockHeaderByNumberResponseFromWire);
  }

  async getBlockByNumber(blockNum: number): Promise<MaybeBlock> {
    return this.callRpc('GetBlockByNumber', { blockNum }, maybeBlockFromWire);
  }

  async syncState(blockNum: number, accountIds: AccountId[], noteTags: number[], nullifierPrefixes: number[] = []): Promise<SyncStateResponse> {
    if (nullifierPrefixes.length > 0) {
      logger.warn('SyncState in miden-node 0.13.4 has no nullifierPrefixes field; ignoring requested prefixes', { count: nullifierPrefixes.length });
    }
    return this.callRpc('SyncState', {
      blockNum,
      accountIds: accountIds.map(accountIdToWire),
      noteTags,
    }, syncStateResponseFromWire);
  }

  async *syncStatePages(blockNum: number, accountIds: AccountId[], noteTags: number[], nullifierPrefixes: number[] = []): AsyncGenerator<SyncStateResponse> {
    let nextBlock = blockNum;
    while (true) {
      const page = await this.syncState(nextBlock, accountIds, noteTags, nullifierPrefixes);
      yield page;
      const returnedBlock = page.blockHeader?.blockNum ?? page.chainTip;
      if (returnedBlock >= page.chainTip) return;
      nextBlock = returnedBlock;
    }
  }

  async getAccount(accountId: AccountId, request?: Omit<AccountRequest, 'accountId'>): Promise<AccountResponse> {
    return this.callRpc('GetAccount', accountRequestToWire(accountId, request), accountResponseFromWire);
  }

  async checkNullifiers(nullifiers: Buffer[]): Promise<CheckNullifiersResponse> {
    return this.callRpc('CheckNullifiers', { nullifiers: nullifiers.map(digestToWire) }, checkNullifiersResponseFromWire);
  }

  async getNotesById(noteIds: Buffer[]): Promise<CommittedNoteList> {
    return this.callRpc('GetNotesById', { ids: noteIds.map((noteId) => ({ id: digestToWire(noteId) })) }, committedNoteListFromWire);
  }

  async getNoteScriptByRoot(scriptRoot: Buffer): Promise<MaybeNoteScript> {
    return this.callRpc('GetNoteScriptByRoot', { root: digestToWire(scriptRoot) }, maybeNoteScriptFromWire);
  }

  /** @todo low-priority: use when note-only sync is needed by the indexer. */
  async syncNotes(request: SyncNotesRequest): Promise<SyncNotesResponse> {
    return this.callRpc('SyncNotes', { blockRange: blockRangeToWire(request.blockRange), noteTags: request.noteTags }, syncNotesResponseFromWire);
  }

  /** @todo low-priority: use when nullifier prefix indexing is needed. */
  async syncNullifiers(request: SyncNullifiersRequest): Promise<SyncNullifiersResponse> {
    return this.callRpc('SyncNullifiers', {
      blockRange: blockRangeToWire(request.blockRange),
      prefixLen: request.prefixLen,
      nullifiers: request.nullifiers,
    }, syncNullifiersResponseFromWire);
  }

  /** @todo low-priority: use when account vault indexing is needed. */
  async syncAccountVault(request: SyncAccountVaultRequest): Promise<SyncAccountVaultResponse> {
    return this.callRpc('SyncAccountVault', {
      blockRange: blockRangeToWire(request.blockRange),
      accountId: accountIdToWire(request.accountId),
    }, syncAccountVaultResponseFromWire);
  }

  /** @todo low-priority: use when public storage map indexing is needed. */
  async syncAccountStorageMaps(request: SyncAccountStorageMapsRequest): Promise<SyncAccountStorageMapsResponse> {
    return this.callRpc('SyncAccountStorageMaps', {
      blockRange: blockRangeToWire(request.blockRange),
      accountId: accountIdToWire(request.accountId),
    }, syncAccountStorageMapsResponseFromWire);
  }

  /** @todo low-priority: use when account-scoped transaction indexing is needed. */
  async syncTransactions(request: SyncTransactionsRequest): Promise<SyncTransactionsResponse> {
    return this.callRpc('SyncTransactions', {
      blockRange: blockRangeToWire(request.blockRange),
      accountIds: request.accountIds.map(accountIdToWire),
    }, syncTransactionsResponseFromWire);
  }
}

export function createMidenRpcClient(config: MidenRpcClientConfig): MidenRpcClient {
  return new MidenRpcClient(config);
}

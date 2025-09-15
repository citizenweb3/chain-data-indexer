// src/assemble/blockJson.ts
/**
 * Assembles a normalized, storage-friendly JSON structure for a Cosmos SDK block.
 * Combines raw RPC responses (block and block_results), decoded transactions,
 * and normalized ABCI events/logs into a single `BlockJson` object.
 * Utilities here are performance-sensitive: avoid heavy copies except where explicitly stripping large fields.
 */
import type { BlockJson, TxsResult, AbciEvent } from '../types.js';
import type { RpcClient } from '../rpc/client.js';
import { normalizeEvents, buildCombinedLogs } from '../normalize/events/index.js';
import { sha256Hex, base64ToBytes, bytesToHex } from '../utils/bytes.js';
import { deepConvertKeys, CaseMode } from '../utils/case.js';
import { stripLarge } from '../utils/stripLarge.js';
import { getLogger } from '../utils/logger.js';

const log = getLogger('assemble/blockJson');

/**
 * Extracts basic block metadata from a Tendermint RPC block response.
 * @param {any} b - Raw response returned by `rpc.block(height)`.
 * @returns {{ chain_id: string; height: string; time: string }} Chain ID, height, and ISO timestamp as strings.
 */
function getMeta(b: any) {
  const header = b?.block?.header ?? {};
  return {
    chain_id: String(header.chain_id ?? ''),
    height: String(header.height ?? b?.block?.last_commit?.height ?? ''),
    time: String(header.time ?? ''),
  };
}

/**
 * Reads base64-encoded transactions from a block response.
 * Filters out non-string values to protect against malformed nodes.
 * @param {any} b - Raw response returned by `rpc.block(height)`.
 * @returns {string[]} Array of base64-encoded transactions.
 */
function getTxsBase64(b: any): string[] {
  const txs = b?.block?.data?.txs;
  return Array.isArray(txs) ? txs.filter((x) => typeof x === 'string') : [];
}

/**
 * Safely aligns `txs_results` with the number of transactions in the block.
 * If the node returns fewer results than transactions, missing entries are filled with defaults.
 * A debug log is emitted when lengths mismatch.
 * @param {any} br - Raw response returned by `rpc.block_results(height)`.
 * @param {number} count - Expected number of transactions.
 * @returns {TxsResult[]} Array of ABCI results aligned to the given count.
 */
function getTxsResults(br: any, count: number): TxsResult[] {
  const arr = Array.isArray(br?.txs_results) ? br.txs_results : [];
  if (arr.length === count) return arr as TxsResult[];
  const out: TxsResult[] = [];
  for (let i = 0; i < count; i++) out.push(arr[i] ?? ({ code: 0, events: [] } as TxsResult));
  if (arr.length !== count) {
    log.debug(`txs_results length mismatch: results=${arr.length} txs=${count}`);
  }
  return out;
}

/**
 * Builds normalized transaction objects for a given block.
 * - Computes the SHA-256 hash from the raw base64 transaction bytes.
 * - Preserves `@type` in `Any` messages while converting payload keys to the selected case.
 * - Attaches ABCI events and a combined log view per transaction.
 *
 * @param {string} heightISOTime - Block time in ISO 8601 format (used for tx timestamps).
 * @param {string[]} txsB64 - Base64-encoded transactions from the block.
 * @param {any[]} decoded - Transactions decoded by the tx decode pool (parallel to `txsB64`).
 * @param {any} br - Raw `block_results` response for the same height.
 * @param {CaseMode} [caseMode='snake'] - Case conversion mode for decoded message payload keys.
 * @returns {Promise<BlockJson['txs']>} Normalized per-transaction records ready for sinks.
 */
export async function assembleTxObjects(
  heightISOTime: string,
  txsB64: string[],
  decoded: any[],
  br: any,
  caseMode: CaseMode = 'snake',
) {
  const results = getTxsResults(br, txsB64.length);
  const out: BlockJson['txs'] = [];

  for (let i = 0; i < txsB64.length; i++) {
    const rawB64 = txsB64[i];
    const rawBytes = base64ToBytes(rawB64!);
    const hash = await sha256Hex(rawBytes);

    const decodedTx = decoded[i] ?? {
      '@type': '/cosmos.tx.v1beta1.Tx',
      body: {
        messages: [],
        memo: '',
        timeout_height: '0',
        unordered: false,
        timeout_timestamp: null,
        extension_options: [],
        non_critical_extension_options: [],
      },
      auth_info: { signer_infos: [], fee: { amount: [], gas_limit: '0', payer: '', granter: '' }, tip: null },
      signatures: [],
    };

    const msgs = Array.isArray(decodedTx?.body?.messages)
      ? decodedTx.body.messages.map((m: any) => {
          if (!m || typeof m !== 'object') return m;
          // Preserve Any type marker exactly, convert only the payload keys
          const { ['@type']: atype, ...rest } = m as Record<string, any>;
          const converted = deepConvertKeys(rest, caseMode);
          return atype !== undefined ? { ['@type']: atype, ...converted } : converted;
        })
      : [];

    const body = { ...decodedTx.body, messages: msgs };

    const r = results[i] ?? ({} as TxsResult);
    const txLevelEvents: AbciEvent[] = normalizeEvents((r?.events as any[]) ?? []);
    const logs = buildCombinedLogs(String(r?.log ?? ''), txLevelEvents);

    out.push({
      index: i,
      hash,
      raw: { base64: rawB64!, hex: bytesToHex(rawBytes).toUpperCase() },
      decoded: { ...decodedTx, body },
      tx_response: {
        height: String(br?.height ?? ''),
        codespace: String(r?.codespace ?? ''),
        code: Number(r?.code ?? 0),
        data: String(r?.data ?? ''),
        raw_log: String(r?.log ?? ''),
        logs,
        events: txLevelEvents,
        gas_wanted: String(r?.gas_wanted ?? ''),
        gas_used: String(r?.gas_used ?? ''),
        timestamp: heightISOTime,
      },
    });
  }

  return out;
}

/**
 * Produces a complete `BlockJson` by combining raw RPC responses and decoded txs.
 * Large / redundant inner fields are stripped to reduce memory/IO via `stripLarge`.
 *
 * @param {RpcClient} rpc - RPC client used to retrieve context as needed.
 * @param {any} blockResp - Raw response from `rpc.fetchBlock(height)`.
 * @param {any} blockResultsResp - Raw response from `rpc.fetchBlockResults(height)`.
 * @param {any[]} decodedTxs - Array of decoded transactions, parallel to block txs.
 * @param {CaseMode} [caseMode='snake'] - Case conversion mode for decoded message payload keys.
 * @returns {Promise<BlockJson>} Fully assembled block representation.
 */
export async function assembleBlockJsonFromParts(
  rpc: RpcClient,
  blockResp: any,
  blockResultsResp: any,
  decodedTxs: any[],
  caseMode: CaseMode = 'snake',
): Promise<BlockJson> {
  const meta = getMeta(blockResp);
  const txsB64 = getTxsBase64(blockResp);
  const txObjs = await assembleTxObjects(meta.time, txsB64, decodedTxs, blockResultsResp, caseMode);
  return {
    meta: { chain_id: meta.chain_id, height: meta.height, time: meta.time },
    block: stripLarge(blockResp),
    block_results: stripLarge(blockResultsResp),
    txs: txObjs,
  };
}

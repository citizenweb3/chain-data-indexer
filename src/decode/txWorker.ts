/**
 * Worker thread that listens for 'init' and 'decode' messages,
 * loads protobuf root if needed, and decodes Cosmos transactions.
 */
import { parentPort } from 'node:worker_threads';
import { loadProtoRootWithProgress } from './dynamicProto.ts';
import { getLogger } from '../utils/logger.ts';
import type {
  InitMsg,
  DecodeMsg,
  InMsg,
  ProgressMsg,
  ReadyMsg,
  WorkerOk,
  WorkerErr,
  OutMsg,
} from './txWorker.types.ts';
import { setProtoRoot, clearProtoRoot } from './decoders/context.ts';
import { decodeTxBase64 } from './decoders/tx.ts';

const log = getLogger('decode/txWorker');

/**
 * Handles the 'init' message: loads proto definitions if a directory is provided,
 * sends progress and ready messages.
 * @param msg - The initialization message containing optional protoDir.
 * @returns Promise<void>
 */
async function onInit(msg: InitMsg) {
  if (!msg.protoDir) {
    clearProtoRoot();
    parentPort!.postMessage({ type: 'ready', ok: true } as ReadyMsg);
    log.warn('[txWorker] no protoDir provided — dynamic decode disabled');
    return;
  }

  try {
    const root = await loadProtoRootWithProgress(
      msg.protoDir,
      (loaded, total) => parentPort!.postMessage({ type: 'progress', loaded, total } as ProgressMsg),
      200,
    );
    setProtoRoot(root);
    parentPort!.postMessage({ type: 'ready', ok: true } as ReadyMsg);
    log.info(`[txWorker] loaded proto root from: ${msg.protoDir}`);
  } catch (e: any) {
    clearProtoRoot();
    parentPort!.postMessage({ type: 'ready', ok: false, detail: String(e?.message ?? e) } as ReadyMsg);
    log.warn(`[txWorker] failed to load proto root: ${String(e?.message ?? e)}`);
  }
}

/**
 * Handles the 'decode' message: decodes a base64 transaction and sends the result back.
 * @param msg - The decode message containing the transaction base64 string and id.
 */
function onDecode(msg: DecodeMsg) {
  try {
    const decoded = decodeTxBase64(msg.txBase64);
    const out: WorkerOk = { id: msg.id, ok: true, decoded };
    parentPort!.postMessage(out as OutMsg);
  } catch (e: any) {
    const out: WorkerErr = { id: msg.id, ok: false, error: String(e?.message ?? e) };
    parentPort!.postMessage(out as OutMsg);
  }
}

/**
 * Routes incoming worker messages to appropriate handlers.
 */
parentPort!.on('message', (msg: InMsg) => {
  if (msg.type === 'init') return void onInit(msg);
  if (msg.type === 'decode') return void onDecode(msg);
});

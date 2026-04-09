/**
 * @module txPool
 * @description
 * This module provides a pool of worker threads for decoding transactions in parallel.
 * It manages worker initialization, job scheduling, and result collection, enabling efficient
 * transaction decoding using multiple threads. The pool is designed to be used in environments
 * where high throughput and non-blocking transaction decoding is required.
 */
// src/decode/txPool.ts
import { Worker } from 'node:worker_threads';
import { getLogger } from '../utils/logger.js';

type ProgressMsg = { type: 'progress'; loaded: number; total: number };
type ReadyMsg = { type: 'ready'; ok: boolean; detail?: string };
type OkMsg = { id: number; ok: true; decoded: any };
type ErrMsg = { id: number; ok: false; error: string };

type AnyOut = ProgressMsg | ReadyMsg | OkMsg | ErrMsg;

/**
 * Represents a pool of worker threads for decoding transactions.
 * @typedef {Object} TxDecodePool
 * @property {(txBase64: string) => Promise<any>} submit - Submit a base64-encoded transaction for decoding.
 *   @param {string} txBase64 - The base64-encoded transaction to decode.
 *   @returns {Promise<any>} - A promise that resolves with the decoded transaction, or rejects on error.
 * @property {() => Promise<void>} close - Gracefully shuts down all worker threads in the pool.
 *   @returns {Promise<void>} - A promise that resolves when all workers have terminated.
 */
export type TxDecodePool = {
  submit: (txBase64: string, timeoutMs?: number) => Promise<any>;
  close: () => Promise<void>;
};

const INIT_TIMEOUT_MS = 30000;
const log = getLogger('decode/txPool');

/**
 * Wraps a promise with a timeout that rejects with a labeled error if exceeded.
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new Error(`timeout: ${label} after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

/**
 * Creates a pool of worker threads for parallel transaction decoding.
 *
 * @param {number} size - The number of worker threads to spawn in the pool.
 * @param {Object} [opts] - Optional settings.
 * @param {string} [opts.protoDir] - Directory containing protobuf definitions for the workers.
 * @returns {TxDecodePool} An object with `submit` and `close` methods for interacting with the pool.
 */
export function createTxDecodePool(size: number, opts?: { protoDir?: string }): TxDecodePool {
  const workers: Worker[] = [];
  const idle: number[] = [];
  const waiters: Array<(wid: number) => void> = [];
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  const readyFlags: boolean[] = Array(size).fill(false);
  const readyResolvers: Array<() => void> = [];
  const readyPromises: Array<Promise<void>> = [];
  const perWorkerProgress: Record<number, { loaded: number; total: number }> = {};

  log.info(`[txPool] creating ${size} worker(s)`);

  for (let i = 0; i < size; i++) {
    const w = new Worker(new URL('./txWorker.ts', import.meta.url), {
      execArgv: ['--import', 'tsx/esm'],
      stdout: true,
      stderr: true,
    });
    // @ts-ignore
    w.stdout?.pipe(process.stdout);
    // @ts-ignore
    w.stderr?.pipe(process.stderr);

    workers.push(w);

    let resolveReady!: () => void;
    let rejectReady!: (e?: any) => void;
    const p = new Promise<void>((resolve, reject) => ((resolveReady = resolve), (rejectReady = reject)));
    p.catch(() => {});
    readyPromises.push(p);
    readyResolvers.push(resolveReady);

    const failWorkerInit = (reason: string, error?: unknown) => {
      if (readyFlags[i]) return;

      clearTimeout(timer);
      readyFlags[i] = true;
      rejectReady(error instanceof Error ? error : new Error(reason));
      void w.terminate().catch(() => {});
    };

    const timer = setTimeout(() => {
      if (!readyFlags[i]) {
        const message = `[txPool] worker #${i} init timeout after ${INIT_TIMEOUT_MS}ms`;
        log.error(message);
        failWorkerInit(message);
      }
    }, INIT_TIMEOUT_MS);

    w.on('online', () => log.info(`[txPool] worker #${i} online`));

    w.on('message', (m: AnyOut | any) => {
      if (m?.type === 'progress') {
        const { loaded, total } = m as ProgressMsg;
        perWorkerProgress[i] = { loaded, total };
        const totals = Object.values(perWorkerProgress);
        if (totals.length > 0) {
          const sumLoaded = totals.reduce((a, b) => a + b.loaded, 0);
          const sumTotal = totals.reduce((a, b) => a + b.total, 0);
          const pct = sumTotal > 0 ? Math.floor((sumLoaded / sumTotal) * 100) : 0;
          log.debug(`[proto] loading: ${sumLoaded}/${sumTotal} (${pct}%)`);
        }
        return;
      }

      if (m?.type === 'ready') {
        if (!readyFlags[i]) {
          clearTimeout(timer);
          if ((m as ReadyMsg).ok !== false) {
            readyFlags[i] = true;
            log.info(`[txPool] worker #${i} ready`);
            idle.push(i);
            resolveReady();
          } else {
            const detail = (m as ReadyMsg).detail ?? '';
            const message = `[txPool] worker #${i} init failed: ${detail}`;
            log.error(message);
            failWorkerInit(message);
          }
        }
        return;
      }

      if (typeof (m as OkMsg | ErrMsg)?.id === 'number') {
        const entry = pending.get((m as OkMsg | ErrMsg).id);
        if (!entry) return;
        pending.delete((m as OkMsg | ErrMsg).id);
        if ((m as OkMsg).ok) entry.resolve((m as OkMsg).decoded);
        else entry.reject(new Error((m as ErrMsg).error));
        if (waiters.length > 0) {
          waiters.shift()!(i);
        } else {
          idle.push(i);
        }
        return;
      }
    });

    w.on('error', (e) => {
      log.error(`[txPool] worker #${i} error: ${e?.message ?? e}`);
      if (!readyFlags[i]) {
        failWorkerInit(`[txPool] worker #${i} error before init`, e);
        return;
      }
      for (const [id, p] of pending) {
        p.reject(e);
        pending.delete(id);
      }
    });

    w.on('exit', (code) => {
      log.warn(`[txPool] worker #${i} exited with code ${code}`);
      if (!readyFlags[i]) {
        failWorkerInit(`[txPool] worker #${i} exited before init with code ${code}`);
      }
    });

    w.postMessage({ type: 'init', protoDir: opts?.protoDir });
  }

  async function waitAllReady() {
    await Promise.all(readyPromises);
  }

  async function submit(txBase64: string, timeoutMs?: number): Promise<any> {
    await waitAllReady();

    // Event-based queue: grab an idle worker or wait for one
    let wid: number;
    if (idle.length > 0) {
      wid = idle.shift()!;
    } else {
      wid = await new Promise<number>((resolve) => waiters.push(resolve));
    }

    const w = workers[wid];
    const id = (Math.random() * 2 ** 31) | 0;
    const decodePromise = new Promise<any>((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });

    w?.postMessage({ type: 'decode', id, txBase64 });

    // Timeout only covers actual decode work, not queue wait time
    if (timeoutMs) {
      return withTimeout(decodePromise, timeoutMs, `decode@worker#${wid}`).catch((err) => {
        decodePromise.catch(() => {}); // suppress unhandled rejection if worker responds with error after timeout
        throw err;
      });
    }
    return decodePromise;
  }

  async function close() {
    await Promise.all(workers.map((w) => w.terminate()));
  }

  return { submit, close };
}

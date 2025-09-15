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
  submit: (txBase64: string) => Promise<any>;
  close: () => Promise<void>;
};

const INIT_TIMEOUT_MS = 30000;
const log = getLogger('decode/txPool');

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
    readyPromises.push(p);
    readyResolvers.push(resolveReady);

    const timer = setTimeout(() => {
      if (!readyFlags[i]) {
        log.error(`[txPool] worker #${i} init timeout after ${INIT_TIMEOUT_MS}ms`);
        readyFlags[i] = true;
        idle.push(i);
        resolveReady();
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
          readyFlags[i] = true;
          clearTimeout(timer);
          if ((m as ReadyMsg).ok !== false) {
            log.info(`[txPool] worker #${i} ready`);
          } else {
            log.warn(`[txPool] worker #${i} init not-ok: ${(m as ReadyMsg).detail ?? ''}`);
          }
          idle.push(i);
          resolveReady();
        }
        return;
      }

      if (typeof (m as OkMsg | ErrMsg)?.id === 'number') {
        const entry = pending.get((m as OkMsg | ErrMsg).id);
        if (!entry) return;
        pending.delete((m as OkMsg | ErrMsg).id);
        idle.push(i);
        if ((m as OkMsg).ok) entry.resolve((m as OkMsg).decoded);
        else entry.reject(new Error((m as ErrMsg).error));
        return;
      }
    });

    w.on('error', (e) => {
      log.error(`[txPool] worker #${i} error: ${e?.message ?? e}`);
      if (!readyFlags[i]) {
        clearTimeout(timer);
        readyFlags[i] = true;
        idle.push(i);
        resolveReady();
      }
      for (const [id, p] of pending) {
        p.reject(e);
        pending.delete(id);
      }
    });

    w.on('exit', (code) => {
      log.warn(`[txPool] worker #${i} exited with code ${code}`);
    });

    w.postMessage({ type: 'init', protoDir: opts?.protoDir });
  }

  async function waitAllReady() {
    await Promise.all(readyPromises);
  }

  async function submit(txBase64: string): Promise<any> {
    await waitAllReady();
    while (idle.length === 0) await new Promise((r) => setTimeout(r, 0));
    const wid = idle.shift()!;
    const w = workers[wid];

    const id = (Math.random() * 2 ** 31) | 0;
    const prom = new Promise<any>((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });

    w?.postMessage({ type: 'decode', id, txBase64 });
    return prom;
  }

  async function close() {
    await Promise.all(workers.map((w) => w.terminate()));
  }

  return { submit, close };
}

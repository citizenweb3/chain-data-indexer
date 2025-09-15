/**
 * @module context
 * This module manages the dynamic protobuf root for transaction decoding.
 * It provides helper functions to set, get, check readiness, and clear the root.
 */
// src/decode/decoders/context.ts
import { getLogger } from '../../utils/logger.ts';

const log = getLogger('decode/txWorker');

let _root: any | undefined;
let _ready = false;

/**
 * Returns a boolean indicating whether the dynamic protobuf root is loaded and ready for decoding.
 */
export function isProtoReady(): boolean {
  return _ready && !!_root;
}

/**
 * Returns the current protobuf root if it is set, with a generic type T, or undefined if not set.
 */
export function getProtoRoot<T = any>(): T | undefined {
  return _root as T | undefined;
}

/**
 * Sets the dynamic protobuf root and marks it as ready.
 * @param root - The protobuf root object to set as the current root.
 */
export function setProtoRoot(root: any): void {
  _root = root;
  _ready = true;
  log.info(`[txWorker] proto root set`);
}

/**
 * Clears the dynamic protobuf root and marks it as not ready.
 */
export function clearProtoRoot(): void {
  _root = undefined;
  _ready = false;
  log.warn(`[txWorker] proto root cleared`);
}

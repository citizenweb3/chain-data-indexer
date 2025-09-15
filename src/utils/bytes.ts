// src/utils/bytes.ts
/**
 * Utility functions for byte encoding/decoding and hashing.
 */

import { fromBase64, toBase64, toHex } from '@cosmjs/encoding';

/**
 * Alias for Uint8Array representing raw bytes.
 */
export type Bytes = Uint8Array;

/**
 * Converts a base64 string to bytes.
 *
 * @param b64 - The base64 encoded string.
 * @returns The decoded bytes as a Uint8Array.
 */
export function base64ToBytes(b64: string): Bytes {
  return fromBase64(b64);
}

/**
 * Converts bytes to a base64 string.
 *
 * @param b - The bytes to encode.
 * @returns The base64 encoded string.
 */
export function bytesToBase64(b: Bytes): string {
  return toBase64(b);
}

/**
 * Converts bytes to a lowercase hex string.
 *
 * @param b - The bytes to convert.
 * @returns The lowercase hexadecimal string representation of the bytes.
 */
export function bytesToHex(b: Bytes): string {
  return toHex(b);
}

/**
 * Converts a hex string (with or without 0x prefix) to bytes.
 *
 * @param hex - The hexadecimal string to convert.
 * @returns The decoded bytes as a Uint8Array.
 * @throws If the hex string length is not even.
 */
export function hexToBytes(hex: string): Bytes {
  const s = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (s.length % 2 !== 0) throw new Error('hex length must be even');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(s.substr(i * 2, 2), 16);
  }
  return out;
}

/**
 * Computes SHA-256 hash of bytes and returns as uppercase hex string.
 *
 * @param bytes - The input bytes to hash.
 * @returns A Promise that resolves to the uppercase hexadecimal string of the SHA-256 hash.
 */
export async function sha256Hex(bytes: Bytes): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = bytesToHex(new Uint8Array(digest));
  return hex.toUpperCase();
}

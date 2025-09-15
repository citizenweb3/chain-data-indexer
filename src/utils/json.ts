/* eslint-disable @typescript-eslint/no-explicit-any */
import { bytesToHex } from "./bytes.js";

/**
 * Безопасный stringify:
 * - BigInt -> string
 * - Uint8Array -> { "@bytes_hex": "..." }
 * - Date -> ISO
 */
/**
 * JSON replacer function that safely handles special value types:
 * - BigInt values are converted to strings.
 * - Uint8Array values are converted to an object with a "@bytes_hex" property containing the hex string.
 * - Date values are converted to ISO string representations.
 * Returns a safe string or object representation suitable for JSON serialization.
 *
 * @param _key - The key of the property being stringified.
 * @param value - The value to replace.
 * @returns The replaced value for safe JSON serialization.
 */
export function safeJsonReplacer(_key: string, value: any) {
    if (typeof value === "bigint") return value.toString();
    if (value instanceof Uint8Array) return { "@bytes_hex": bytesToHex(value) };
    if (value instanceof Date) return value.toISOString();
    return value;
}

/**
 * Safely stringifies an object using {@link safeJsonReplacer} to handle special types,
 * such as BigInt, Uint8Array, and Date. Optionally formats the output with spaces for pretty printing.
 *
 * @param obj - The object to stringify.
 * @param space - The number of spaces to use for indentation (default: 2).
 * @returns The JSON string representation of the object.
 */
export function safeJsonStringify(obj: unknown, space = 2): string {
    return JSON.stringify(obj, safeJsonReplacer, space);
}
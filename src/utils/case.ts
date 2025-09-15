// src/utils/case.ts
// Deep key case conversion for plain JSON-like values.

export type CaseMode = "snake" | "camel";

const isPlainObject = (v: any) =>
    v !== null && typeof v === "object" && !Array.isArray(v) && Object.prototype.toString.call(v) === "[object Object]";

/**
 * Converts a string from camelCase or other formats to snake_case.
 * Replaces uppercase letters with _letter, replaces dashes and spaces with underscores, and lowercases the result.
 * @param {string} k - The string key to convert.
 * @returns {string} The snake_case version of the key.
 */
function toSnakeKey(k: string): string {
    return k
        .replace(/([A-Z])/g, "_$1")
        .replace(/[-\s]+/g, "_")
        .toLowerCase();
}

/**
 * Converts a string from snake_case, kebab-case, or space-separated to camelCase.
 * @param {string} k - The string key to convert.
 * @returns {string} The camelCase version of the key.
 */
function toCamelKey(k: string): string {
    return k.replace(/[_-\s]+([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Converts keys of objects deeply, leaving arrays and primitives intact.
 * Special-case: preserves keys that start with "@" (e.g. "@type") as-is.
 */
export function deepConvertKeys<T = any>(input: T, mode: CaseMode): T {
    if (Array.isArray(input)) {
        return input.map((x) => deepConvertKeys(x, mode)) as any;
    }
    if (isPlainObject(input)) {
        const out: any = {};
        for (const [k, v] of Object.entries(input as any)) {
            const newKey = k.startsWith("@") ? k : mode === "snake" ? toSnakeKey(k) : toCamelKey(k);
            out[newKey] = deepConvertKeys(v as any, mode);
        }
        return out;
    }
    return input;
}
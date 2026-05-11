/**
 * Utilities to dynamically load and decode protobuf definitions, including
 * recursive loading of .proto files, batch loading with progress, and decoding of `Any` messages.
 * Provides helpers for working with type URLs and protobuf roots.
 */
// src/decode/dynamicProto.ts
import fs from 'node:fs';
import path from 'node:path';
import protobuf from 'protobufjs';
import { getLogger } from '../utils/logger.ts';
import { decodeCustomMessage, normalizeDecodedMessage } from './decoders/customMessages.ts';

const log = getLogger('decode/dynamicProto');

/**
 * Recursively collects all `.proto` file paths from a directory.
 * @param dir - The directory to search for `.proto` files.
 * @returns An array of file paths to `.proto` files.
 */
export function collectProtoFiles(dir: string): string[] {
  const out: string[] = [];
  (function walk(d: string) {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && p.endsWith('.proto')) out.push(p);
    }
  })(dir);
  return out;
}

/**
 * Loads all `.proto` files from a directory into a protobuf Root, in batches,
 * and optionally reports progress via a callback.
 * @param protoDir - Directory containing `.proto` files.
 * @param onProgress - Optional callback receiving (loaded, total) after each batch.
 * @param batchSize - Number of files to load per batch (default 200).
 * @returns Promise resolving to the loaded protobuf.Root.
 */
export async function loadProtoRootWithProgress(
  protoDir: string,
  onProgress?: (loaded: number, total: number) => void,
  batchSize = 200,
): Promise<protobuf.Root> {
  const files = collectProtoFiles(protoDir);
  if (files.length === 0) throw new Error(`No .proto files found in ${protoDir}`);

  const root = new protobuf.Root({ keepCase: true });

  root.resolvePath = (_origin, target) => {
    if (path.isAbsolute(target)) return target;
    return path.join(protoDir, target);
  };

  let loaded = 0;
  const total = files.length;

  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    await new Promise<void>((resolve, reject) => {
      root.load(batch, (err) => (err ? reject(err) : resolve()));
    });
    loaded += batch.length;
    onProgress?.(Math.min(loaded, total), total);
  }

  root.resolveAll();
  log.debug('Loaded proto root', { totalFiles: total });
  return root;
}

/**
 * Loads all `.proto` files from a directory into a protobuf Root, without progress callback.
 * @param protoDir - Directory containing `.proto` files.
 * @returns Promise resolving to the loaded protobuf.Root.
 */
export async function loadProtoRoot(protoDir: string): Promise<protobuf.Root> {
  return loadProtoRootWithProgress(protoDir);
}

/**
 * Converts a type URL to a fully qualified protobuf type name.
 * @param typeUrl - The type URL (e.g., "/foo.bar.Baz").
 * @returns The fully qualified type name (e.g., "foo.bar.Baz").
 */
export function typeUrlToFullName(typeUrl: string): string {
  return typeUrl.startsWith('/') ? typeUrl.slice(1) : typeUrl;
}

/**
 * Returns true if the value looks like an unresolved `google.protobuf.Any`
 * ({type_url: string, value: string|Uint8Array} with exactly 2 keys).
 */
function isUnresolvedAny(val: any): boolean {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return false;
  const keys = Object.keys(val);
  if (keys.length !== 2) return false;
  // protobufjs uses snake_case (type_url), cosmjs-types uses camelCase (typeUrl)
  const tu = val.type_url ?? val.typeUrl;
  return typeof tu === 'string' && tu.length > 0 && val.value != null;
}

/**
 * Walks a decoded protobuf object in-place and recursively decodes
 * any unresolved `google.protobuf.Any` fields ({type_url, value}).
 * Depth-limited to 5 to prevent infinite recursion.
 */
export function resolveNestedAny(obj: any, root: protobuf.Root, depth = 0): void {
  if (depth > 5 || !obj || typeof obj !== 'object') return;

  for (const key of Object.keys(obj)) {
    const val = obj[key];

    if (isUnresolvedAny(val)) {
      try {
        const tu = val.type_url ?? val.typeUrl;
        const bytes = typeof val.value === 'string' ? Buffer.from(val.value, 'base64') : val.value;
        obj[key] = decodeAnyWithRoot(tu, bytes, root, depth + 1);
      } catch {
        /* keep original if type not found or decode fails */
      }
    } else if (Array.isArray(val)) {
      for (let i = 0; i < val.length; i++) {
        if (isUnresolvedAny(val[i])) {
          try {
            const tu = val[i].type_url ?? val[i].typeUrl;
            const bytes = typeof val[i].value === 'string' ? Buffer.from(val[i].value, 'base64') : val[i].value;
            val[i] = decodeAnyWithRoot(tu, bytes, root, depth + 1);
          } catch {
            /* keep original */
          }
        } else if (val[i] && typeof val[i] === 'object') {
          resolveNestedAny(val[i], root, depth + 1);
        }
      }
    } else if (typeof val === 'object') {
      resolveNestedAny(val, root, depth + 1);
    }
  }
}

/**
 * Decodes a protobuf `Any` message using the provided protobuf root.
 * Recursively resolves nested Any fields after decoding.
 * @param typeUrl - The type URL of the message to decode.
 * @param value - The binary message data (as Uint8Array).
 * @param root - The protobuf.Root containing loaded types.
 * @returns The decoded message as a plain object, including an `@type` property.
 */
export function decodeAnyWithRoot(
  typeUrl: string,
  value: Uint8Array,
  root: protobuf.Root,
  _depth = 0,
): Record<string, unknown> {
  const custom = decodeCustomMessage(typeUrl, value);
  if (custom) return custom;

  const fullName = typeUrlToFullName(typeUrl);
  const Type = root.lookupType(fullName);
  if (!Type) throw new Error(`Type not found in proto root: ${fullName}`);
  const msg = Type.decode(value);
  const obj = Type.toObject(msg, {
    longs: String,
    enums: String,
    bytes: (b: Uint8Array) => Buffer.from(b).toString('base64'),
    defaults: true,
    arrays: true,
    objects: true,
    oneofs: true,
  }) as Record<string, unknown>;
  resolveNestedAny(obj, root, _depth);
  obj['@type'] = typeUrl;
  return normalizeDecodedMessage(typeUrl, obj);
}

// src/normalize/events/parse.ts
import type { AbciEvent } from '../../types.js';
import { normalizeEvents } from './normalize.js';

/**
 * Parses a Tendermint/Cosmos "raw_log" JSON string into structured per-message events.
 * The raw log typically looks like an array of objects:
 *   [{ msg_index: number, events: [{type, attributes:[{key,value,index?}]}] }, ...]
 * @param rawLog - Raw JSON string from tx logs.
 * @returns Array of { msg_index, events } entries. Returns [] on invalid JSON or shape.
 */
export function parseRawLogToStructured(rawLog?: string): Array<{ msg_index: number; events: AbciEvent[] }> {
  if (!rawLog) return [];
  try {
    const parsed = JSON.parse(rawLog);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((entry) => {
      const msgIdx = Number(entry?.msg_index ?? entry?.msgIndex ?? 0);
      const events = normalizeEvents(entry?.events);
      return { msg_index: Number.isFinite(msgIdx) ? msgIdx : 0, events };
    });
  } catch {
    return [];
  }
}

/**
 * Builds a combined log view:
 * - Per-message events parsed from `raw_log`
 * - Plus optional tx-level events appended as a pseudo-message with msg_index = null
 * @param rawLog - Raw JSON "raw_log".
 * @param txLevelEvents - Tx-level events (from DeliverTx) to include.
 * @returns Combined array of { msg_index | null, events }.
 */
export function buildCombinedLogs(
  rawLog: string | undefined,
  txLevelEvents: any[] | undefined,
): Array<{ msg_index: number | null; events: AbciEvent[] }> {
  const msgLevel = parseRawLogToStructured(rawLog);
  const txLevel = normalizeEvents(txLevelEvents);
  const combined: Array<{ msg_index: number | null; events: AbciEvent[] }> = [...msgLevel];
  if (txLevel.length > 0) {
    combined.push({ msg_index: null, events: txLevel });
  }
  return combined;
}

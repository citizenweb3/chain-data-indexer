# Governance Extraction v3 — Final Fixes

**Date:** 2026-03-23
**Status:** Approved
**Depends on:** v1 (2026-03-22), v2 (2026-03-23)

## Problems Found During Smoke Testing

### Problem 1: v1beta1 proposal title/description empty
**Root cause:** Protobuf decoder (`decodeAnyWithRoot`) does not recursively decode nested `google.protobuf.Any` fields. v1beta1 `MsgSubmitProposal.content` is Any containing `TextProposal` with `title` and `description`, but decoded as raw `{type_url, value: base64}`.

### Problem 2: msg_index = -1 for tx-level events
**Root cause:** Flat tx-level events from `block_results.txs_results[].events` don't carry `msg_index` in log structure. `pickLogs()` sets `msg_index = -1`. But the actual msg_index is available in event attributes as `{"key": "msg_index", "value": "0"}`.
**Already fixed** in v3 — added `findAttr(attrsPairs, 'msg_index')` fallback.

### Problem 3: proposal_type empty for v1
**Root cause:** v1 nested messages stored as `{type_url: "...", value: "base64"}` not `{@type: "..."}`. Code checked `innerMsg?.['@type']` only.
**Already fixed** in v3 — added `innerMsg?.type_url` fallback.

### Problem 4: Weighted votes — only first option stored
**Already fixed** in v3 — iterate all options, PK includes `option`.

### Problem 5: firstSigner fallback for submitter
**Already fixed** in v3 — removed `firstSigner` from fallback chain.

## Remaining Fix: Recursive Any Decode

### Change: `src/decode/dynamicProto.ts`

Add in-place recursive Any resolver after `Type.toObject()`:

```typescript
/**
 * Walks a decoded protobuf object in-place and recursively decodes
 * any unresolved `google.protobuf.Any` fields ({type_url, value}).
 * Depth-limited to 5 to prevent infinite recursion.
 */
function resolveNestedAny(obj: any, root: protobuf.Root, depth = 0): void {
  if (depth > 5 || !obj || typeof obj !== 'object') return;
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (isUnresolvedAny(val)) {
      try {
        const bytes = typeof val.value === 'string'
          ? Buffer.from(val.value, 'base64')
          : val.value;
        obj[key] = decodeAnyWithRoot(val.type_url, bytes, root);
      } catch { /* keep as-is if type not found */ }
    } else if (Array.isArray(val)) {
      for (let i = 0; i < val.length; i++) {
        if (isUnresolvedAny(val[i])) {
          try {
            const bytes = typeof val[i].value === 'string'
              ? Buffer.from(val[i].value, 'base64')
              : val[i].value;
            val[i] = decodeAnyWithRoot(val[i].type_url, bytes, root);
          } catch { /* keep as-is */ }
        } else if (val[i] && typeof val[i] === 'object') {
          resolveNestedAny(val[i], root, depth + 1);
        }
      }
    } else if (typeof val === 'object') {
      resolveNestedAny(val, root, depth + 1);
    }
  }
}

function isUnresolvedAny(val: any): boolean {
  return val && typeof val === 'object'
    && typeof val.type_url === 'string' && val.type_url
    && val.value != null
    && Object.keys(val).length === 2;
}
```

Modify `decodeAnyWithRoot` to call `resolveNestedAny` before return:

```typescript
export function decodeAnyWithRoot(...): Record<string, unknown> {
  // ... existing code ...
  const obj = Type.toObject(msg, { ... }) as Record<string, unknown>;
  resolveNestedAny(obj, root);  // <-- ADD THIS
  obj['@type'] = typeUrl;
  return obj;
}
```

### Performance Impact

- Decode time is ~3-5ms per block (0.1% of total). RPC fetch is 2000-7000ms.
- In-place mutation: zero allocations beyond decoded nested objects.
- Depth limit 5: prevents runaway recursion.
- Most messages have no nested Any: walk exits quickly (5-10 field checks).
- Impact: negligible.

### Effect on gov extraction

After this fix, v1beta1 `MsgSubmitProposal.content` will decode from:
```json
{"type_url": "/cosmos.gov.v1beta1.TextProposal", "value": "base64..."}
```
to:
```json
{"@type": "/cosmos.gov.v1beta1.TextProposal", "title": "Some Proposal", "description": "Details..."}
```

The existing extraction code `content?.title` and `content?.description` will then work correctly.

### Side effects (positive)

All messages with nested Any get proper decoding:
- IBC: `MsgRecvPacket.packet.data`
- Authz: `MsgExec.msgs[]`
- Feegrant: `MsgGrantAllowance.allowance`
- Group: `MsgSubmitProposal.messages[]`

## Test Plan

1. Rebuild docker, re-run blocks 23876150-23876155 (v1beta1 proposal)
2. Verify `gov.proposals.title` is now populated
3. Re-run blocks 30032500-30032740 (v1 proposal) — should still work
4. Check no errors in logs for any block range

## Files Changed (v3 total)

| File | Change |
|------|--------|
| `src/decode/dynamicProto.ts` | Add `resolveNestedAny` + `isUnresolvedAny`, call from `decodeAnyWithRoot` |
| `src/sink/postgres.ts` | msg_index fallback, type_url fallback, weighted vote loop, firstSigner removal |
| `src/sink/pg/flushers/gov.ts` | COPY dedup key with `option` |
| `initdb/010-indexer-schema.sql` | `title NULL`, `option` in PK |

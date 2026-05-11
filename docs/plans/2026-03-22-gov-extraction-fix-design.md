# Governance Extraction Fix — Design Document

**Date:** 2026-03-22
**Status:** Approved
**Scope:** `src/sink/postgres.ts` (single file change)

## Problem

`extractGovFromBlock()` in `src/normalize/gov.ts:30` is defined but never called.
In `PostgresSink.extractRows()` (postgres.ts:524-534), code reads `blockLine.gov`,
but this field is never populated — the assembly pipeline does not call gov extraction.

Result: `govDepositsRows`, `govVotesRows`, `govProposalsRows` are always empty.
Governance data (deposits, votes, proposals) is never written to PostgreSQL.

## What Already Works

- Flushers: `flushGovDeposits`, `flushGovVotes`, `upsertGovProposals` — ready
- Inserters: ready
- DB tables: `gov.deposits`, `gov.votes`, `gov.proposals` — created
- `drainDerived()` correctly calls gov flushers
- `derivedQueue.push()` already includes govDeposits/govVotes/govProposals fields
- Two-stream pipeline: gov goes through derived stream (non-blocking via setImmediate)

## Root Cause

Original design intended `extractGovFromBlock()` to be called upstream (in assembly
or pre-sink), populating `blockLine.gov`. The consumer code (lines 524-534) was written,
but the producer call was never wired up.

## Decision: Inline Extraction (not `extractGovFromBlock`)

We will NOT use `extractGovFromBlock()` because it expects a different data format:
- It reads `m.type_url` and `m.value.proposal_id` (raw RPC format)
- In `extractRows()`, msgs have `m['@type']` and fields at top level (decoded protobuf)
- It expects `eventsByMsg` grouped by msg_index — not available in current loop structure

Instead, we add inline extraction directly in `extractRows()`, following the exact
pattern already used for wasm (lines 360-377), transfers (396-412), and staking (414-478).

## Changes

### Change 1: MsgDeposit extraction (msgs loop, after line 377)

In the existing `for (let i = 0; i < msgs.length; i++)` loop, add:

```typescript
if (t === '/cosmos.gov.v1beta1.MsgDeposit' || t === '/cosmos.gov.v1.MsgDeposit') {
  const pid = BigInt(m?.proposal_id ?? 0);
  const depositor = m?.depositor ?? null;
  const coins: Array<{ denom: string; amount: string }> = Array.isArray(m?.amount) ? m.amount : [];
  if (pid > 0n && depositor) {
    for (const c of coins) {
      govDepositsRows.push({
        proposal_id: pid,
        depositor,
        denom: String(c.denom ?? ''),
        amount: String(c.amount ?? '0'),
        height,
        tx_hash,
      });
    }
  }
}
```

### Change 2: MsgVote extraction (msgs loop, after MsgDeposit)

```typescript
if (t === '/cosmos.gov.v1beta1.MsgVote' || t === '/cosmos.gov.v1.MsgVote') {
  const pid = BigInt(m?.proposal_id ?? 0);
  const voter = m?.voter ?? null;
  const weighted: Array<{ option: string; weight: string }> | undefined = m?.options;
  if (pid > 0n && voter) {
    if (Array.isArray(weighted) && weighted.length > 0) {
      const first = weighted[0];
      govVotesRows.push({
        proposal_id: pid,
        voter,
        option: String(first?.option ?? 'UNKNOWN'),
        weight: String(first?.weight ?? '0'),
        height,
        tx_hash,
      });
    } else {
      govVotesRows.push({
        proposal_id: pid,
        voter,
        option: String(m?.option ?? 'UNKNOWN'),
        weight: null,
        height,
        tx_hash,
      });
    }
  }
}
```

### Change 3: MsgSubmitProposal extraction (events loop)

In the events loop (alongside `transfer`, `delegate` handlers), add:

```typescript
if (event_type === 'submit_proposal') {
  const pidAttr = findAttr(attrsPairs, 'proposal_id');
  if (pidAttr) {
    const pid = BigInt(pidAttr);
    if (pid > 0n) {
      const mm = msg_index >= 0 && msg_index < msgs.length ? msgs[msg_index] : null;
      const content = mm?.content || mm?.messages?.[0];
      govProposalsRows.push({
        proposal_id: pid,
        submitter: mm?.signer ?? mm?.from_address ?? mm?.proposer ?? firstSigner ?? null,
        title: content?.title ? String(content.title) : null,
        summary: (content?.description ?? content?.summary) ? String(content.description ?? content.summary) : null,
        proposal_type: content?.['@type'] ? String(content['@type']) : null,
        status: 'deposit_period' as const,
        submit_time: time,
      });
    }
  }
}
```

### Change 4: Remove dead `blockLine.gov` consumer (lines 524-534)

Delete:
```typescript
const gov = blockLine?.gov ?? {};
if (Array.isArray(gov.deposits)) {
  for (const r of gov.deposits) govDepositsRows.push(r);
}
if (Array.isArray(gov.votes)) {
  for (const r of gov.votes) govVotesRows.push(r);
}
if (Array.isArray(gov.proposals)) {
  for (const r of gov.proposals) govProposalsRows.push(r);
}
```

## Performance Impact

None. Gov extraction is pure CPU parsing of already-decoded messages.
Results go through derived stream (non-blocking setImmediate).

## Files Not Changed

- `src/normalize/gov.ts` — kept as-is (different data format, may be useful later)
- `src/sink/pg/flushers/gov.ts` — already works
- `src/sink/pg/inserters/` — no gov inserters needed (flushers handle it)
- `initdb/` — tables already exist
- `drainDerived()` — already wired up for gov

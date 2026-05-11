# Governance Extraction v2 — Fix Three Limitations

**Date:** 2026-03-23
**Status:** Approved
**Depends on:** 2026-03-22-gov-extraction-fix-design.md (completed)

## Context

Initial gov extraction fix is deployed and tested. Three limitations discovered during smoke test:

1. Proposal title/submitter/summary empty for v1 format
2. Initial deposit at proposal submission not captured
3. MsgVoteWeighted type_url not matched

## Real Data Formats (verified via LCD API)

### MsgSubmitProposal v1 (cosmoshub blocks after ~15.8M)
```json
{
  "@type": "/cosmos.gov.v1.MsgSubmitProposal",
  "messages": [{"@type": "/cosmos.upgrade.v1beta1.MsgSoftwareUpgrade", "plan": {...}}],
  "initial_deposit": [{"denom": "uatom", "amount": "50000000"}],
  "proposer": "cosmos1...",
  "title": "Gaia v27.0.0 Upgrade",
  "summary": "# Summary...",
  "metadata": "ipfs://CID"
}
```
Fields after snake_case conversion: `mm.title`, `mm.summary`, `mm.proposer`, `mm.initial_deposit`, `mm.messages`.

### MsgSubmitProposal v1beta1 (cosmoshub blocks ~9M-15.8M)
```json
{
  "@type": "/cosmos.gov.v1beta1.MsgSubmitProposal",
  "content": {
    "@type": "/cosmos.gov.v1beta1.TextProposal",
    "title": "Some Proposal",
    "description": "Details..."
  },
  "initial_deposit": [{"denom": "uatom", "amount": "50000000"}],
  "proposer": "cosmos1..."
}
```
Fields after snake_case: `content.title`, `content.description`, `mm.proposer`, `mm.initial_deposit`.

### MsgVoteWeighted
```json
{
  "@type": "/cosmos.gov.v1beta1.MsgVoteWeighted",
  "proposal_id": "873",
  "voter": "cosmos1...",
  "options": [{"option": "VOTE_OPTION_NO_WITH_VETO", "weight": "1.000000000000000000"}]
}
```
Same structure as MsgVote with options array — existing weighted logic handles it.

## Changes

### Change 1: MsgVoteWeighted (msgs loop, line ~397)

Extend type check:
```typescript
if (
  t === '/cosmos.gov.v1beta1.MsgVote' || t === '/cosmos.gov.v1.MsgVote' ||
  t === '/cosmos.gov.v1beta1.MsgVoteWeighted' || t === '/cosmos.gov.v1.MsgVoteWeighted'
) {
```
Existing weighted vote logic already handles the `options` array.

### Change 2: Proposal title/submitter/summary (events loop, submit_proposal handler)

Replace current extraction logic:
```typescript
const mm = msg_index >= 0 && msg_index < msgs.length ? msgs[msg_index] : null;
const content = mm?.content;  // v1beta1: has title, description
const innerMsg = Array.isArray(mm?.messages) ? mm.messages[0] : null;  // v1: nested Any

// v1: title/summary at top level; v1beta1: inside content
const title = mm?.title || content?.title || null;
const summary = mm?.summary || content?.description || null;
const proposer = mm?.proposer || mm?.signer || mm?.from_address || firstSigner || null;
const proposalType = content?.['@type'] || innerMsg?.['@type'] || null;
```

### Change 3: Initial deposit from proposal_deposit event (events loop, new block)

Add handler for `event_type === 'proposal_deposit'`:
```typescript
if (event_type === 'proposal_deposit') {
  const pidAttr = findAttr(attrsPairs, 'proposal_id');
  const depositor = findAttr(attrsPairs, 'depositor');
  const amountStr = findAttr(attrsPairs, 'amount');  // "50000000uatom"
  if (pidAttr && depositor && amountStr) {
    let pid: bigint;
    try { pid = BigInt(pidAttr); } catch { pid = 0n; }
    const coin = parseCoin(amountStr);
    if (pid > 0n && coin) {
      govDepositsRows.push({
        proposal_id: pid,
        depositor,
        denom: coin.denom,
        amount: coin.amount,
        height,
        tx_hash,
      });
    }
  }
}
```

## DDL Change

Already applied: `initdb/010-indexer-schema.sql` line 391: `title TEXT NULL` (was NOT NULL).

## Test Plan

Three docker test runs:

| Test | FROM | TO | Validates |
|------|------|-----|-----------|
| v1 proposals | 30032500 | 30032740 | title='Gaia v27.0.0 Upgrade', 2 deposits, 2 votes |
| v1beta1 proposals | 23876150 | 23876155 | title from content.title, initial deposit |
| MsgVoteWeighted | 18821980 | 18821985 | option='VOTE_OPTION_NO_WITH_VETO', weight filled |

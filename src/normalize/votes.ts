// src/normalize/votes.ts
//
// Pure helpers for extracting gov.votes rows from decoded transaction messages.
// Kept dependency-free (no pg/logger imports) so vote classification, weight
// normalization, the authz unwrap, and the tx-success gate can be unit-tested in
// isolation. The sink (src/sink/postgres.ts) builds gov.votes rows through these.

export interface GovVoteRow {
  proposal_id: bigint;
  voter: string;
  option: string;
  weight: string | null;
  height: number;
  tx_hash: string | null;
}

const GOV_VOTE_TYPES = new Set([
  '/cosmos.gov.v1beta1.MsgVote',
  '/cosmos.gov.v1.MsgVote',
  '/cosmos.gov.v1beta1.MsgVoteWeighted',
  '/cosmos.gov.v1.MsgVoteWeighted',
]);

const AUTHZ_EXEC_TYPES = new Set(['/cosmos.authz.v1beta1.MsgExec', '/cosmos.authz.v1.MsgExec']);

export const isGovVoteType = (t: string): boolean => GOV_VOTE_TYPES.has(t);
export const isAuthzExecType = (t: string): boolean => AUTHZ_EXEC_TYPES.has(t);

const msgType = (m: any): string => m?.['@type'] ?? m?.type_url ?? '';

/**
 * Normalize a Cosmos SDK vote weight to a decimal string.
 * The SDK emits either an 18-decimal integer ("1000000000000000000" = 1.0) or an
 * already-decimal string ("1.000..."). Integer forms are rescaled by 10^18.
 */
export const normalizeVoteWeight = (raw: string | number | undefined | null): string => {
  let w = String(raw ?? '0');
  if (/^\d+$/.test(w) && w !== '0') {
    const padded = w.padStart(19, '0');
    const intPart = padded.slice(0, padded.length - 18) || '0';
    const decPart = padded.slice(padded.length - 18);
    w = `${intPart}.${decPart}`;
  }
  return w;
};

/**
 * Build gov.votes rows from a single MsgVote / MsgVoteWeighted message: one row per
 * weighted option, or a single row for a simple vote. Empty when the message lacks a
 * proposal id or voter.
 */
export const voteRowsFromMsg = (mm: any, height: number, tx_hash: string | null): GovVoteRow[] => {
  let pid: bigint;
  try {
    pid = BigInt(mm?.proposal_id ?? 0);
  } catch {
    pid = 0n;
  }
  const voter = mm?.voter ?? null;
  if (!(pid > 0n) || !voter) return [];

  const weighted: Array<{ option?: string; weight?: string }> | undefined = mm?.options;
  if (Array.isArray(weighted) && weighted.length > 0) {
    return weighted.map((opt) => ({
      proposal_id: pid,
      voter,
      option: String(opt?.option ?? 'UNKNOWN'),
      weight: normalizeVoteWeight(opt?.weight),
      height,
      tx_hash,
    }));
  }

  return [
    {
      proposal_id: pid,
      voter,
      option: String(mm?.option ?? 'UNKNOWN'),
      weight: null,
      height,
      tx_hash,
    },
  ];
};

/**
 * Extract every gov.votes row from a top-level transaction message — direct votes and
 * authz-delegated votes (MsgExec wrapping MsgVote, one level deep). The inner MsgVote
 * carries voter = the validator account (the granter), so an unwrapped authz vote is
 * indistinguishable from a direct vote downstream.
 *
 * Gated on tx success: a failed tx (code !== 0) is reverted in full, so no vote it
 * carried — direct or authz-wrapped — ever applied. Emitting one would be a phantom
 * vote that can outrank the validator's real vote downstream (the read API keeps the
 * highest height per proposal).
 */
export const govVoteRowsFromTopMsg = (
  m: any,
  code: number,
  height: number,
  tx_hash: string | null,
): GovVoteRow[] => {
  if (code !== 0) return [];

  const t = msgType(m);
  if (isGovVoteType(t)) return voteRowsFromMsg(m, height, tx_hash);

  if (isAuthzExecType(t)) {
    const inner: any[] = Array.isArray(m?.msgs) ? m.msgs : [];
    return inner.flatMap((im) => (isGovVoteType(msgType(im)) ? voteRowsFromMsg(im, height, tx_hash) : []));
  }

  return [];
};

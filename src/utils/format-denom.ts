const HEX_TAIL_RE = /(0x[0-9a-fA-F]{6,})/;
const BECH32_RE = /^[a-z]+1[ac-hj-np-z02-9]{38,}$/;

const truncate = (s: string, max = 12): string =>
  s.length > max ? `${s.slice(0, max - 1)}…` : s;

const formatLeafDenom = (leaf: string): string => {
  if (leaf.startsWith('0x') && leaf.length > 10) {
    return `${leaf.slice(0, 8)}…`;
  }
  if (leaf.startsWith('ibc/')) {
    return `ibc/${leaf.slice(4, 10)}…`;
  }
  if (leaf.startsWith('u') && leaf.length >= 4 && leaf.length <= 8) {
    return leaf.slice(1).toUpperCase();
  }
  return truncate(leaf, 14);
};

export const formatDenomDisplay = (
  denom: string | null,
  symbol: string | null,
): string => {
  if (symbol) return symbol;
  if (!denom || denom === '__unknown__') return 'unknown';
  if (denom.startsWith('ibc/')) return `ibc/${denom.slice(4, 10)}…`;

  if (denom.startsWith('gravity')) {
    const hex = denom.match(HEX_TAIL_RE);
    if (hex) return `gravity${hex[0].slice(0, 6)}…`;
  }

  if (denom.startsWith('cosmosvaloper') && denom.includes('/')) {
    const id = denom.split('/').pop() ?? '';
    return `lsm/${id}`;
  }

  if (denom.includes(':')) {
    const leaf = denom.split(':').pop() ?? '';
    return formatLeafDenom(leaf);
  }

  if (denom.includes('/')) {
    const leaf = denom.split('/').pop() ?? '';
    return formatLeafDenom(leaf);
  }

  if (denom.includes('.')) {
    const leaf = denom.split('.').pop() ?? '';
    return formatLeafDenom(leaf);
  }

  if (BECH32_RE.test(denom)) {
    return `${denom.slice(0, 10)}…`;
  }

  return formatLeafDenom(denom);
};

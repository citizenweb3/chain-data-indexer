export const formatNative = (
  amount: string | bigint | null | undefined,
  decimals: number,
): string | null => {
  if (amount === null || amount === undefined) return null;

  const raw = typeof amount === 'bigint' ? amount.toString() : amount;
  if (raw === '') return null;

  const negative = raw.startsWith('-');
  const digits = negative ? raw.slice(1) : raw;
  if (!/^\d+$/.test(digits)) return null;

  if (decimals <= 0) return (negative ? '-' : '') + digits;

  const padded = digits.padStart(decimals + 1, '0');
  const cut = padded.length - decimals;
  const intPart = padded.slice(0, cut);
  const fracPart = padded.slice(cut).replace(/0+$/, '');

  const head = intPart.replace(/^0+(?=\d)/, '');
  const body = fracPart ? `${head}.${fracPart}` : head;
  return negative ? `-${body}` : body;
};

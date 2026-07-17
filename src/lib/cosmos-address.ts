import { bech32 } from 'bech32';

const MAX_BECH32_LENGTH = 128;

const decodeAccountAddress = (address: string, expectedPrefix?: string) => {
  const decoded = bech32.decode(address, MAX_BECH32_LENGTH);
  if (decoded.prefix.endsWith('valoper') || decoded.prefix.endsWith('valcons')) {
    throw new Error('expected an account address prefix');
  }
  if (expectedPrefix && decoded.prefix !== expectedPrefix) {
    throw new Error(`expected ${expectedPrefix} account prefix`);
  }
  return decoded;
};

export const isAccountBech32Address = (address: string, expectedPrefix?: string): boolean => {
  try {
    decodeAccountAddress(address, expectedPrefix);
    return true;
  } catch {
    return false;
  }
};

export const toValoperAddress = (accountAddress: string, expectedPrefix?: string): string => {
  const decoded = decodeAccountAddress(accountAddress, expectedPrefix);
  return bech32.encode(`${decoded.prefix}valoper`, decoded.words, MAX_BECH32_LENGTH);
};

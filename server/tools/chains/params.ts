// Pure metadata + a server-only env reader. Safe to import from any layer; `requireEnv` only fires when called.

export type ChainParams = {
  name: string;
  displayName: string;
  chainId: string;
  upstreamBaseUrl: string;
  apiKeyEnv: string;
};

export const requireEnv = (name: string): string => {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
};

export const CHAIN_PARAMS: ChainParams[] = [
  {
    name: 'cosmoshub',
    displayName: 'Cosmos Hub',
    chainId: 'cosmoshub-4',
    upstreamBaseUrl: 'https://indexer.cosmoshub-4.citizenweb3.com/api/v1',
    apiKeyEnv: 'COSMOSHUB_INDEXER_API_KEY',
  },
  {
    name: 'atomone',
    displayName: 'AtomOne',
    chainId: 'atomone-1',
    upstreamBaseUrl: 'https://indexer.atomone.citizenweb3.com/api/v1',
    apiKeyEnv: 'ATOMONE_INDEXER_API_KEY',
  },
];

export const getChainParams = (name: string): ChainParams => {
  const p = CHAIN_PARAMS.find((c) => c.name === name);
  if (!p) throw new Error(`Unknown chain: ${name}`);
  return p;
};

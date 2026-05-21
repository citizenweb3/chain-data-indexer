// SERVER ONLY — uses process.env at module load.

export type ChainParams = {
  name: string;
  displayName: string;
  chainId: string;
  upstreamBaseUrl: string;
  apiKeyEnv: string;
};

const requireEnv = (name: string): string => {
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
    upstreamBaseUrl: requireEnv('COSMOSHUB_INDEXER_BASE_URL'),
    apiKeyEnv: 'COSMOSHUB_INDEXER_API_KEY',
  },
  {
    name: 'atomone',
    displayName: 'AtomOne',
    chainId: 'atomone-1',
    upstreamBaseUrl: requireEnv('ATOMONE_INDEXER_BASE_URL'),
    apiKeyEnv: 'ATOMONE_INDEXER_API_KEY',
  },
];

export const getChainParams = (name: string): ChainParams => {
  const p = CHAIN_PARAMS.find((c) => c.name === name);
  if (!p) throw new Error(`Unknown chain: ${name}`);
  return p;
};

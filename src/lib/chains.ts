// Client- and server-safe chain registry. No `process.env` reads — safe to import
// from RSC, route handlers, middleware, and components. The DB `chains` table is
// the runtime source of truth (FK enforcement); this tuple is the compile-time
// list used by routing, middleware, and Zod validation.
//
// Adding a chain requires updating this list AND server/tools/chains/params.ts
// AND seeding the new row in the `chains` table.

export const CHAIN_NAMES = ['cosmoshub', 'atomone'] as const;

export type ChainName = (typeof CHAIN_NAMES)[number];

export type ChainMetadata = {
  displayName: string;
  nativeDenom: string;
  nativeSymbol: string;
  nativeDecimals: number;
};

export const CHAIN_METADATA = {
  cosmoshub: {
    displayName: 'Cosmos Hub',
    nativeDenom: 'uatom',
    nativeSymbol: 'ATOM',
    nativeDecimals: 6,
  },
  atomone: {
    displayName: 'AtomOne',
    nativeDenom: 'uatone',
    nativeSymbol: 'ATONE',
    nativeDecimals: 6,
  },
} as const satisfies Record<ChainName, ChainMetadata>;

export const CHAIN_DISPLAY_NAMES: Record<ChainName, string> = {
  cosmoshub: CHAIN_METADATA.cosmoshub.displayName,
  atomone: CHAIN_METADATA.atomone.displayName,
};

export const isChainName = (s: string): s is ChainName =>
  (CHAIN_NAMES as readonly string[]).includes(s);

export const getChainMetadata = (chain: ChainName): ChainMetadata => CHAIN_METADATA[chain];

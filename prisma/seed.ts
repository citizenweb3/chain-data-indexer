import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

type AssetSeed = {
  symbol: string;
  coingeckoId: string;
  decimals: number;
  nativeDenom: string;
};

const ASSETS: AssetSeed[] = [
  { symbol: 'ATOM',    coingeckoId: 'cosmos',                  decimals: 6,  nativeDenom: 'uatom' },
  { symbol: 'OSMO',    coingeckoId: 'osmosis',                 decimals: 6,  nativeDenom: 'uosmo' },
  { symbol: 'USDC',    coingeckoId: 'usd-coin',                decimals: 6,  nativeDenom: 'uusdc' },
  { symbol: 'IRIS',    coingeckoId: 'iris-network',            decimals: 6,  nativeDenom: 'uiris' },
  { symbol: 'stATOM',  coingeckoId: 'stride-staked-atom',      decimals: 6,  nativeDenom: 'stuatom' },
  { symbol: 'KUJI',    coingeckoId: 'kujira',                  decimals: 6,  nativeDenom: 'ukuji' },
  { symbol: 'ISLM',    coingeckoId: 'islamic-coin',            decimals: 18, nativeDenom: 'aISLM' },
  { symbol: 'KOPI',    coingeckoId: 'kopi',                    decimals: 6,  nativeDenom: 'ukopi' },
  { symbol: 'WBTC',    coingeckoId: 'wrapped-bitcoin',         decimals: 8,  nativeDenom: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599' },
  { symbol: 'WETH',    coingeckoId: 'weth',                    decimals: 18, nativeDenom: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' },
  { symbol: 'USDT',    coingeckoId: 'tether',                  decimals: 6,  nativeDenom: '0xdac17f958d2ee523a2206206994597c13d831ec7' },
  { symbol: 'PAXG',    coingeckoId: 'pax-gold',                decimals: 18, nativeDenom: '0x45804880de22913dafe09f4980848ece6ecbaf78' },
  { symbol: 'XPRT',    coingeckoId: 'persistence',             decimals: 6,  nativeDenom: 'uxprt' },
  { symbol: 'STRD',    coingeckoId: 'stride',                  decimals: 6,  nativeDenom: 'ustrd' },
  { symbol: 'EVMOS',   coingeckoId: 'evmos',                   decimals: 18, nativeDenom: 'aevmos' },
  { symbol: 'NTRN',    coingeckoId: 'neutron-3',               decimals: 6,  nativeDenom: 'untrn' },
  { symbol: 'STARS',   coingeckoId: 'stargaze',                decimals: 6,  nativeDenom: 'ustars' },
  { symbol: 'AKT',     coingeckoId: 'akash-network',           decimals: 6,  nativeDenom: 'uakt' },
  { symbol: 'INJ',     coingeckoId: 'injective-protocol',      decimals: 18, nativeDenom: 'inj' },
  { symbol: 'JUNO',    coingeckoId: 'juno-network',            decimals: 6,  nativeDenom: 'ujuno' },
  { symbol: 'DVPN',    coingeckoId: 'sentinel',                decimals: 6,  nativeDenom: 'udvpn' },
  { symbol: 'CORE',    coingeckoId: 'coreum',                  decimals: 6,  nativeDenom: 'ucore' },
  { symbol: 'SEDA',    coingeckoId: 'seda-2',                  decimals: 18, nativeDenom: 'aseda' },
  { symbol: 'ZIG',     coingeckoId: 'zignaly',                 decimals: 6,  nativeDenom: 'uzig' },
  { symbol: 'stOSMO',  coingeckoId: 'stride-staked-osmo',      decimals: 6,  nativeDenom: 'stuosmo' },
  { symbol: 'stINJ',   coingeckoId: 'stride-staked-injective', decimals: 18, nativeDenom: 'stinj' },
  { symbol: 'stSTARS', coingeckoId: 'stride-staked-stars',     decimals: 6,  nativeDenom: 'stustars' },
  { symbol: 'stJUNO',  coingeckoId: 'stride-staked-juno',      decimals: 6,  nativeDenom: 'stujuno' },
  { symbol: 'USDT.n',  coingeckoId: 'tether',                  decimals: 6,  nativeDenom: 'uusdt' },
  { symbol: 'USDT.s',  coingeckoId: 'tether',                  decimals: 6,  nativeDenom: 'erc20/tether/usdt' },
  { symbol: 'USDT.a',  coingeckoId: 'tether',                  decimals: 6,  nativeDenom: 'factory/osmo1em6xs47hd82806f5cxgyufguxrrc7l0aqx7nzzptjuqgswczk8csavdxek/alloyed/allUSDT' },
  { symbol: 'ARCH',    coingeckoId: 'archway',                 decimals: 18, nativeDenom: 'aarch' },
  { symbol: 'DYM',     coingeckoId: 'dymension',               decimals: 18, nativeDenom: 'adym' },
  { symbol: 'ORAI',    coingeckoId: 'oraichain-token',         decimals: 6,  nativeDenom: 'orai' },
  { symbol: 'UMEE',    coingeckoId: 'umee',                    decimals: 6,  nativeDenom: 'uumee' },
  { symbol: 'CRO',     coingeckoId: 'crypto-com-chain',        decimals: 8,  nativeDenom: 'basecro' },
  { symbol: 'FET',     coingeckoId: 'fetch-ai',                decimals: 18, nativeDenom: 'afet' },
  { symbol: 'BBN',     coingeckoId: 'babylon',                 decimals: 6,  nativeDenom: 'ubbn' },
  { symbol: 'ELYS',    coingeckoId: 'elys-network',            decimals: 6,  nativeDenom: 'uelys' },
  { symbol: 'AUTO',    coingeckoId: 'auto-2',                  decimals: 6,  nativeDenom: 'factory:kujira13x2l25mpkhwnwcwdzzd34cr8fyht9jlj7xu9g4uffe36g3fmln8qkvm3qn:uauto' },
  { symbol: 'MNTA',    coingeckoId: 'mantadao',                decimals: 6,  nativeDenom: 'factory:kujira1643jxg8wasy5cfcn7xm8rd742yeazcksqlg4d7:umnta' },
  { symbol: 'NAMI',    coingeckoId: 'nami-protocol',           decimals: 6,  nativeDenom: 'factory:kujira13x2l25mpkhwnwcwdzzd34cr8fyht9jlj7xu9g4uffe36g3fmln8qkvm3qn:unami' },
  { symbol: 'FUZN',    coingeckoId: 'fuzion',                  decimals: 6,  nativeDenom: 'factory:kujira1sc6a0347cc5q3k890jj0pf3ylx2s38rh4sza4t:ufuzn' },
  { symbol: 'dATOM',   coingeckoId: 'drop-staked-atom',        decimals: 6,  nativeDenom: 'factory/neutron1k6hr0f83e7un2wjf29cspk7j69jrnskk65k3ek2nj9dztrlzpj6q00rtsa/udatom' },
  { symbol: 'milkTIA', coingeckoId: 'milkyway-staked-tia',     decimals: 6,  nativeDenom: 'factory/osmo1f5vfcph2dvfeqcqkhetwv75fda69z7e5c2dldm3kvgj23crkv6wqcn47a0/umilkTIA' },
  { symbol: 'stLUNA',  coingeckoId: 'stride-staked-luna',      decimals: 6,  nativeDenom: 'stuluna' },
  { symbol: 'stEVMOS', coingeckoId: 'stride-staked-evmos',     decimals: 18, nativeDenom: 'staevmos' },
  { symbol: 'stUMEE',  coingeckoId: 'stride-staked-umee',      decimals: 6,  nativeDenom: 'stuumee' },
  { symbol: 'ALLO',    coingeckoId: 'allora',                  decimals: 18, nativeDenom: 'uallo' },
  { symbol: 'NEWT',    coingeckoId: 'newton-protocol',         decimals: 18, nativeDenom: 'factory/neutron1p8d89wvxyjcnawmgw72klknr3lg9gwwl6ypxda/newt' },
  { symbol: 'SAUCE',   coingeckoId: 'saucerswap',              decimals: 6,  nativeDenom: 'factory/neutron133xakkrfksq39wxy575unve2nyehg5npx75nph/sauce' },
  { symbol: 'ROWAN',   coingeckoId: 'sifchain',                decimals: 18, nativeDenom: 'rowan' },
  { symbol: 'allXRP',  coingeckoId: 'ripple',                  decimals: 6,  nativeDenom: 'factory/osmo1qnglc04tmhg32uc4kxlxh55a5cmhj88cpa3rmtly484xqu82t79sfv94w0/alloyed/allXRP' },
  { symbol: 'AVAX',    coingeckoId: 'avalanche-2',             decimals: 18, nativeDenom: 'wavax-wei' },
  { symbol: 'USDY',    coingeckoId: 'ondo-us-dollar-yield',    decimals: 18, nativeDenom: 'ausdy' },
  { symbol: 'BLD',     coingeckoId: 'agoric',                  decimals: 6,  nativeDenom: 'ubld' },
  { symbol: 'stkATOM', coingeckoId: 'stkatom',                 decimals: 6,  nativeDenom: 'stk/uatom' },
];

async function main() {
  for (const asset of ASSETS) {
    await db.asset.upsert({
      where: { nativeDenom: asset.nativeDenom },
      update: {
        symbol: asset.symbol,
        coingeckoId: asset.coingeckoId,
        decimals: asset.decimals,
      },
      create: asset,
    });
  }
  console.log(`seeded ${ASSETS.length} assets`);
}

main()
  .then(async () => {
    await db.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await db.$disconnect();
    process.exit(1);
  });

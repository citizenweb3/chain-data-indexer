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
  { symbol: 'ATOM',   coingeckoId: 'cosmos',              decimals: 6,  nativeDenom: 'uatom' },
  { symbol: 'OSMO',   coingeckoId: 'osmosis',             decimals: 6,  nativeDenom: 'uosmo' },
  { symbol: 'USDC',   coingeckoId: 'usd-coin',            decimals: 6,  nativeDenom: 'uusdc' },
  { symbol: 'IRIS',   coingeckoId: 'iris-network',        decimals: 6,  nativeDenom: 'uiris' },
  { symbol: 'stATOM', coingeckoId: 'stride-staked-atom',  decimals: 6,  nativeDenom: 'stuatom' },
  { symbol: 'KUJI',   coingeckoId: 'kujira',              decimals: 6,  nativeDenom: 'ukuji' },
  { symbol: 'ISLM',   coingeckoId: 'islamic-coin',        decimals: 18, nativeDenom: 'aISLM' },
  { symbol: 'KOPI',   coingeckoId: 'kopi',                decimals: 6,  nativeDenom: 'ukopi' },
  { symbol: 'WBTC',   coingeckoId: 'wrapped-bitcoin',     decimals: 8,  nativeDenom: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599' },
  { symbol: 'WETH',   coingeckoId: 'weth',                decimals: 18, nativeDenom: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' },
  { symbol: 'USDT',   coingeckoId: 'tether',              decimals: 6,  nativeDenom: '0xdac17f958d2ee523a2206206994597c13d831ec7' },
  { symbol: 'PAXG',   coingeckoId: 'pax-gold',            decimals: 18, nativeDenom: '0x45804880de22913dafe09f4980848ece6ecbaf78' },
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

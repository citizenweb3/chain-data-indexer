import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

async function main() {
  await db.asset.upsert({
    where: { nativeDenom: 'uatom' },
    update: {},
    create: {
      symbol: 'ATOM',
      coingeckoId: 'cosmos',
      decimals: 6,
      nativeDenom: 'uatom',
    },
  });
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

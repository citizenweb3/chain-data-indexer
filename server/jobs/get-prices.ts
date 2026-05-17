import { db } from '@/db';
import logger from '@/logger';

import { getAllAssets } from '../tools/assets';

const log = logger('get-prices');

type SimplePriceResponse = Record<string, { usd?: number } | undefined>;

export const runGetPrices = async (): Promise<void> => {
  const startedAt = Date.now();
  log.logInfo('get-prices started');

  try {
    const assets = await getAllAssets();
    if (assets.length === 0) {
      log.logWarn('no assets configured, skipping');
      return;
    }

    const ids = assets.map((a) => a.coingeckoId).join(',');
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`;
    log.logInfo(`fetching ${url}`);

    const apiKey = process.env.COINGECKO_API_KEY;
    const headers: Record<string, string> = {};
    if (apiKey) headers['x-cg-demo-api-key'] = apiKey;

    const response = await fetch(url, { signal: AbortSignal.timeout(15_000), headers });
    if (!response.ok) {
      throw new Error(`coingecko /simple/price ${response.status}`);
    }
    const prices = (await response.json()) as SimplePriceResponse;

    let inserted = 0;
    for (const asset of assets) {
      const usd = prices[asset.coingeckoId]?.usd;
      if (typeof usd !== 'number' || !Number.isFinite(usd)) {
        log.logWarn(`no usd price for ${asset.symbol} (${asset.coingeckoId})`);
        continue;
      }
      await db.price.create({ data: { assetId: asset.id, usd } });
      inserted++;
      log.logDebug(`price for ${asset.symbol} = ${usd}`);
    }

    const elapsedMs = Date.now() - startedAt;
    log.logInfo('get-prices finished', { inserted, elapsedMs });
  } catch (err) {
    log.logError('get-prices failed', err);
    throw err;
  }
};

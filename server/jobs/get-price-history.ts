import type { Asset } from '@prisma/client';

import { db } from '@/db';
import logger from '@/logger';

import { getAllAssets } from '../tools/assets';

const log = logger('get-price-history');

type MarketChartResponse = {
  prices?: [number, number][];
};

const RETRIES = 5;
const REQUEST_DELAY = 1500;
const RETRY_DELAY = 5000;
const TOO_MANY_REQUESTS_DELAY = 60_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const toUTCDate = (timestamp: number): Date => {
  const d = new Date(timestamp);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

const processAssetWithRetry = async (asset: Asset, retries = RETRIES): Promise<boolean> => {
  const lastHistory = await db.priceHistory.findFirst({
    where: { assetId: asset.id },
    orderBy: { date: 'desc' },
  });

  const firstPrice = await db.price.findFirst({
    where: { assetId: asset.id },
    orderBy: { createdAt: 'asc' },
  });

  const lastDate = lastHistory ? lastHistory.date : null;
  const firstPriceDate = firstPrice ? toUTCDate(firstPrice.createdAt.getTime()) : null;

  if (lastDate && firstPriceDate && lastDate >= firstPriceDate) {
    log.logInfo(`[${asset.symbol}] no gap between PriceHistory and Price, skipping`);
    return true;
  }

  if (lastDate && !firstPriceDate) {
    log.logInfo(`[${asset.symbol}] PriceHistory exists but no Price records, skipping`);
    return true;
  }

  const apiKey = process.env.COINGECKO_API_KEY;
  const headers: Record<string, string> = {};
  if (apiKey) headers['x-cg-demo-api-key'] = apiKey;

  for (let i = 0; i < retries; i++) {
    try {
      const url = `https://api.coingecko.com/api/v3/coins/${asset.coingeckoId}/market_chart?vs_currency=usd&days=365&interval=daily`;
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000), headers });

      if (response.status === 429) {
        log.logError(`[${asset.symbol}] 429 Too Many Requests, waiting ${TOO_MANY_REQUESTS_DELAY / 1000}s`);
        await sleep(TOO_MANY_REQUESTS_DELAY);
        continue;
      }

      if (response.status === 404) {
        log.logWarn(`[${asset.symbol}] coingeckoId ${asset.coingeckoId} not found (404), skipping`);
        return true;
      }

      if (!response.ok) {
        log.logError(`[${asset.symbol}] bad response: ${response.status}`);
        await sleep(RETRY_DELAY);
        continue;
      }

      const data = (await response.json()) as MarketChartResponse;
      if (!data.prices || data.prices.length === 0) {
        log.logInfo(`[${asset.symbol}] no price data returned from CoinGecko`);
        return true;
      }

      const points = data.prices
        .filter(([, value]) => Number.isFinite(value) && value >= 0)
        .map(([timestamp, value]) => ({ date: toUTCDate(timestamp), value }))
        .filter((point) => {
          if (lastDate && point.date <= lastDate) return false;
          if (firstPriceDate && point.date >= firstPriceDate) return false;
          return true;
        });

      if (points.length === 0) {
        log.logInfo(`[${asset.symbol}] no new points to insert after filtering`);
        return true;
      }

      await db.$transaction(
        points.map((point) =>
          db.priceHistory.upsert({
            where: { assetId_date: { assetId: asset.id, date: point.date } },
            create: { assetId: asset.id, date: point.date, usd: point.value },
            update: { usd: point.value },
          }),
        ),
      );

      log.logInfo(`[${asset.symbol}] inserted ${points.length} price history points`);
      return true;
    } catch (e) {
      log.logError(`[${asset.symbol}] error`, e);
      if (i === retries - 1) {
        log.logError(`[${asset.symbol}] couldn't update after ${retries} retries`);
      } else {
        await sleep(RETRY_DELAY);
      }
    }
  }
  return false;
};

export const runGetPriceHistory = async (): Promise<void> => {
  const startedAt = Date.now();
  log.logInfo('get-price-history started');

  const assets = await getAllAssets();
  if (assets.length === 0) {
    log.logWarn('no assets configured, skipping');
    return;
  }

  const failed: string[] = [];
  for (const asset of assets) {
    const ok = await processAssetWithRetry(asset);
    if (!ok) failed.push(asset.symbol);
    await sleep(REQUEST_DELAY);
  }

  const elapsedMs = Date.now() - startedAt;
  log.logInfo('get-price-history finished', {
    elapsedMs,
    total: assets.length,
    failed: failed.length,
  });

  if (failed.length > 0) {
    throw new Error(
      `get-price-history: ${failed.length}/${assets.length} assets failed: ${failed.join(', ')}`,
    );
  }
};

import type { Asset } from '@prisma/client';
import { db } from '@/db';

export const getAssetByDenom = async (denom: string): Promise<Asset | null> => {
  return db.asset.findUnique({ where: { nativeDenom: denom } });
};

export const getAllAssets = async (): Promise<Asset[]> => {
  return db.asset.findMany({ orderBy: { id: 'asc' } });
};

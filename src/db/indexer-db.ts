import postgres from 'postgres';
import { env } from '@/env';

export const db = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 60,
  connect_timeout: 10,
  max_lifetime: 1800,
  types: {
    bigint: postgres.BigInt,
  },
  prepare: true,
});

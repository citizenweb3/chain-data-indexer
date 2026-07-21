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
  connection: {
    // postgres.js omits falsy StartupMessage values, so this must stay a string rather than false.
    jit: 'off',
  },
  prepare: true,
});

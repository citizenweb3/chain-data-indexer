import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { Client } from 'pg';

const execFileAsync = promisify(execFile);
const TEST_DATABASE_PREFIX = 'crosschain_s0_test_';
const TEST_DATABASE_NAME = new RegExp(`^${TEST_DATABASE_PREFIX}[a-z0-9_]+$`);
const DEFAULT_ADMIN_URL = 'postgresql://app:app@localhost:5434/postgres';
const REPOSITORY_ROOT = fileURLToPath(new URL('../..', import.meta.url));

export type DisposablePostgres = {
  databaseUrl: string;
  client: Client;
};

const quoteDatabaseName = (databaseName: string): string => {
  if (!TEST_DATABASE_NAME.test(databaseName)) {
    throw new Error(`Refusing unsafe test database name: ${databaseName}`);
  }
  return `"${databaseName}"`;
};

const makeDatabaseUrl = (adminUrl: string, databaseName: string): string => {
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  url.searchParams.delete('schema');
  return url.toString();
};

const deployMigrations = async (databaseUrl: string): Promise<void> => {
  await execFileAsync('yarn', ['db:deploy'], {
    cwd: REPOSITORY_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    maxBuffer: 10 * 1024 * 1024,
  });
};

export const withDisposablePostgres = async <T>(
  run: (database: DisposablePostgres) => Promise<T>,
): Promise<T> => {
  const adminUrl = process.env.TEST_DATABASE_URL ?? DEFAULT_ADMIN_URL;
  const databaseName = `${TEST_DATABASE_PREFIX}${process.pid}_${randomUUID().replaceAll('-', '')}`;
  const quotedDatabaseName = quoteDatabaseName(databaseName);
  const admin = new Client({ connectionString: adminUrl });
  let databaseClient: Client | null = null;

  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${quotedDatabaseName}`);
    const databaseUrl = makeDatabaseUrl(adminUrl, databaseName);
    await deployMigrations(databaseUrl);

    databaseClient = new Client({ connectionString: databaseUrl });
    await databaseClient.connect();
    return await run({ databaseUrl, client: databaseClient });
  } finally {
    await databaseClient?.end();
    await admin.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [databaseName],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${quotedDatabaseName}`);
    await admin.end();
  }
};

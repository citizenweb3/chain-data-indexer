import assert from 'node:assert/strict';
import test from 'node:test';

import { getConfig } from '../config.ts';

const TEST_ENV_KEYS = [
  'RPC_URL',
  'SINK',
  'CH_URL',
  'CH_DATABASE',
  'CH_USERNAME',
  'CH_PASSWORD',
  'RESUME',
  'FOLLOW',
];

function withTestEnv(overrides: Record<string, string>, run: () => void): void {
  const originalArgv = [...process.argv];
  const originalValues = new Map(TEST_ENV_KEYS.map((key) => [key, process.env[key]]));

  process.argv = ['node', 'config-test'];

  for (const key of TEST_ENV_KEYS) {
    delete process.env[key];
  }

  Object.assign(process.env, overrides);

  try {
    run();
  } finally {
    process.argv = originalArgv;
    for (const key of TEST_ENV_KEYS) {
      const originalValue = originalValues.get(key);
      if (originalValue === undefined) {
        delete process.env[key];
        continue;
      }

      process.env[key] = originalValue;
    }
  }
}

test('getConfig accepts clickhouse sink settings from env', () => {
  withTestEnv(
    {
      RPC_URL: 'http://127.0.0.1:26657',
      SINK: 'clickhouse',
      CH_URL: 'http://127.0.0.1:8123',
      CH_DATABASE: 'analytics',
      CH_USERNAME: 'ingester',
      CH_PASSWORD: 'secret',
      RESUME: 'true',
      FOLLOW: 'false',
    },
    () => {
      const cfg = getConfig();

      assert.equal(cfg.sinkKind, 'clickhouse');
      assert.deepEqual(cfg.ch, {
        url: 'http://127.0.0.1:8123',
        database: 'analytics',
        username: 'ingester',
        password: 'secret',
      });
    },
  );
});

test('getConfig defaults clickhouse connection database to core without table overrides', () => {
  withTestEnv(
    {
      RPC_URL: 'http://127.0.0.1:26657',
      SINK: 'clickhouse',
      CH_URL: 'http://127.0.0.1:8123',
      RESUME: 'true',
      FOLLOW: 'false',
    },
    () => {
      const cfg = getConfig();

      assert.equal(cfg.sinkKind, 'clickhouse');
      assert.equal(cfg.ch?.database, 'core');
      assert.ok(cfg.ch && !('table' in cfg.ch));
    },
  );
});

test('getConfig accepts null sink for benchmark baseline without database requirements', () => {
  withTestEnv(
    {
      RPC_URL: 'http://127.0.0.1:26657',
      SINK: 'null',
      RESUME: 'false',
      FOLLOW: 'false',
    },
    () => {
      const cfg = getConfig();

      assert.equal(cfg.sinkKind, 'null');
    },
  );
});

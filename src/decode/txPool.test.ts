import assert from 'node:assert/strict';
import test from 'node:test';

import * as txPoolModule from './txPool.js';

type ResolveTxWorkerRuntime = (moduleUrl: string | URL) => {
  workerUrl: URL;
  execArgv?: string[];
};

function resolveTxWorkerRuntime(moduleUrl: string | URL) {
  return (txPoolModule as { resolveTxWorkerRuntime?: ResolveTxWorkerRuntime }).resolveTxWorkerRuntime?.(moduleUrl);
}

test('resolveTxWorkerRuntime uses ts worker with tsx loader from source module path', () => {
  const runtime = resolveTxWorkerRuntime('file:///pool0/dev-cosm/src/decode/txPool.ts');

  assert.deepEqual(runtime, {
    workerUrl: new URL('file:///pool0/dev-cosm/src/decode/txWorker.ts'),
    execArgv: ['--import', 'tsx/esm'],
  });
});

test('resolveTxWorkerRuntime uses js worker without tsx loader from dist module path', () => {
  const runtime = resolveTxWorkerRuntime('file:///pool0/dev-cosm/dist/decode/txPool.js');

  assert.deepEqual(runtime, {
    workerUrl: new URL('file:///pool0/dev-cosm/dist/decode/txWorker.js'),
    execArgv: [],
  });
});

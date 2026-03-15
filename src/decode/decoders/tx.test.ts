import assert from 'node:assert/strict';
import test from 'node:test';

import { AuthInfo, TxBody, TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx.js';

import { decodeTxBase64 } from './tx.ts';

test('decodeTxBase64 decodes TxRaw bytes with the current cosmjs decodeTxRaw API', () => {
  const bodyBytes = TxBody.encode({
    messages: [],
    memo: 'unit-test-memo',
    timeoutHeight: 0n,
    extensionOptions: [],
    nonCriticalExtensionOptions: [],
  }).finish();

  const authInfoBytes = AuthInfo.encode({
    signerInfos: [],
    fee: {
      amount: [],
      gasLimit: 0n,
      payer: '',
      granter: '',
    },
  }).finish();

  const rawBytes = TxRaw.encode({
    bodyBytes,
    authInfoBytes,
    signatures: [Uint8Array.from([1, 2, 3])],
  }).finish();

  const decoded = decodeTxBase64(Buffer.from(rawBytes).toString('base64'));

  assert.equal(decoded.body.memo, 'unit-test-memo');
  assert.equal(decoded.auth_info.fee.gas_limit, '0');
  assert.deepEqual(decoded.signatures, [Buffer.from([1, 2, 3]).toString('base64')]);
});

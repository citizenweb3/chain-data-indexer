import assert from 'node:assert/strict';
import test from 'node:test';
import protobuf from 'protobufjs';
import { decodeTxRaw } from '@cosmjs/proto-signing';
import { ClientUpdateProposal } from 'cosmjs-types/ibc/core/client/v1/client.js';
import { decodeCustomMessage, normalizeDecodedMessage } from './customMessages.ts';

const FAILING_TX_B64 =
  'CscBCsQBCjkvaW50ZXJjaGFpbl9zZWN1cml0eS5jY3YucHJvdmlkZXIudjEuTXNnQXNzaWduQ29uc3VtZXJLZXkShgEKCW5ldXRyb24tMRI0Y29zbW9zdmFsb3BlcjE1dXJxMmR0cDlxY2U0ZnljODVtNnVwd205eHVsMzA0OWUwMjcwNxpDCh0vY29zbW9zLmNyeXB0by5lZDI1NTE5LlB1YktleRIiCiApQH/vle3EOFDPLfoJXwOxbWwPgIaccM31Ga2scRUFgBJoClEKRgofL2Nvc21vcy5jcnlwdG8uc2VjcDI1NmsxLlB1YktleRIjCiEChQCcacGxPvEa/Y9OchBt8ri3ig3KKYaTYCE/B+DGrdMSBAoCCAEY7wISEwoNCgV1YXRvbRIEOTAwMBCg9zYaQKT9XQBt+avPFvlNOEwFzF/qIYZyVGTJxtjKSJi++XusMF2baRUtRWOyiJhvAaseN5tj7sT0BYMlcsRo8MlTJmY=';

test('decodeCustomMessage normalizes MsgAssignConsumerKey consumer_key payloads', () => {
  const txRaw = decodeTxRaw(Buffer.from(FAILING_TX_B64, 'base64'));
  const message = txRaw.body.messages[0];

  assert.ok(message);
  assert.equal(message.typeUrl, '/interchain_security.ccv.provider.v1.MsgAssignConsumerKey');

  const decoded = decodeCustomMessage(message.typeUrl, message.value);
  assert.ok(decoded);
  assert.equal(decoded['@type'], message.typeUrl);
  assert.equal(decoded.chainId, 'neutron-1');
  assert.equal(decoded.providerAddr, 'cosmosvaloper15urq2dtp9qce4fyc85m6upwm9xul3049e02707');
  assert.equal(decoded.signer, '');
  assert.equal(decoded.consumerId, '');
  assert.deepEqual(decoded.consumerKey, {
    '@type': '/cosmos.crypto.ed25519.PubKey',
    key: 'KUB/75XtxDhQzy36CV8DsW1sD4CGnHDN9RmtrHEVBYA=',
  });
});

function encodeCoin(denom: string, amount: string) {
  const writer = protobuf.Writer.create();
  writer.uint32(10).string(denom);
  writer.uint32(18).string(amount);
  return writer.finish();
}

test('decodeCustomMessage decodes MsgCreatePool liquidity payloads', () => {
  const writer = protobuf.Writer.create();
  writer.uint32(10).string('cosmos1poolcreator');
  writer.uint32(16).uint32(1);
  writer.uint32(34).bytes(encodeCoin('uatom', '100'));
  writer.uint32(34).bytes(encodeCoin('uosmo', '200'));

  const decoded = decodeCustomMessage('/tendermint.liquidity.v1beta1.MsgCreatePool', writer.finish());

  assert.deepEqual(decoded, {
    '@type': '/tendermint.liquidity.v1beta1.MsgCreatePool',
    poolCreatorAddress: 'cosmos1poolcreator',
    poolTypeId: 1,
    depositCoins: [
      { denom: 'uatom', amount: '100' },
      { denom: 'uosmo', amount: '200' },
    ],
  });
});

test('decodeCustomMessage decodes MsgSwapWithinBatch liquidity payloads', () => {
  const writer = protobuf.Writer.create();
  writer.uint32(10).string('cosmos1swapper');
  writer.uint32(16).uint64(42);
  writer.uint32(24).uint32(1);
  writer.uint32(34).bytes(encodeCoin('uatom', '1000'));
  writer.uint32(42).string('uosmo');
  writer.uint32(50).bytes(encodeCoin('uatom', '3'));
  writer.uint32(58).string('1.2345');

  const decoded = decodeCustomMessage('/tendermint.liquidity.v1beta1.MsgSwapWithinBatch', writer.finish());

  assert.deepEqual(decoded, {
    '@type': '/tendermint.liquidity.v1beta1.MsgSwapWithinBatch',
    swapRequesterAddress: 'cosmos1swapper',
    poolId: '42',
    swapTypeId: 1,
    offerCoin: { denom: 'uatom', amount: '1000' },
    demandCoinDenom: 'uosmo',
    offerCoinFee: { denom: 'uatom', amount: '3' },
    orderPrice: '1.2345',
  });
});

test('normalizeDecodedMessage decodes ClientUpdateProposal content inside MsgSubmitProposal', () => {
  const contentBytes = ClientUpdateProposal.encode({
    title: 'recover client',
    description: 'recover subject from substitute',
    subjectClientId: '07-tendermint-1',
    substituteClientId: '07-tendermint-2',
  }).finish();

  const normalized = normalizeDecodedMessage('/cosmos.gov.v1beta1.MsgSubmitProposal', {
    '@type': '/cosmos.gov.v1beta1.MsgSubmitProposal',
    content: {
      typeUrl: '/ibc.core.client.v1.ClientUpdateProposal',
      value: contentBytes,
    },
  });

  assert.deepEqual(normalized.content, {
    '@type': '/ibc.core.client.v1.ClientUpdateProposal',
    title: 'recover client',
    description: 'recover subject from substitute',
    subjectClientId: '07-tendermint-1',
    substituteClientId: '07-tendermint-2',
  });
});

test('normalizeDecodedMessage parses IBC packet data and acknowledgement JSON', () => {
  const normalized = normalizeDecodedMessage('/ibc.core.channel.v1.MsgAcknowledgement', {
    '@type': '/ibc.core.channel.v1.MsgAcknowledgement',
    packet: {
      data: Buffer.from(JSON.stringify({ amount: '7', denom: 'uatom' })).toString('base64'),
    },
    acknowledgement: Buffer.from(JSON.stringify({ result: 'AQ==' })).toString('base64'),
  });

  assert.deepEqual(normalized.packet, {
    data: { amount: '7', denom: 'uatom' },
  });
  assert.deepEqual(normalized.acknowledgement, { result: 'AQ==' });
});

test('normalizeDecodedMessage parses JSON channel version strings', () => {
  const normalized = normalizeDecodedMessage('/ibc.core.channel.v1.MsgChannelOpenTry', {
    '@type': '/ibc.core.channel.v1.MsgChannelOpenTry',
    channel: {
      version: '{"version":"ics27-1","controller_connection_id":"connection-0"}',
    },
    counterpartyVersion: '{"version":"ics27-1"}',
  });

  assert.deepEqual(normalized.channel, {
    version: {
      version: 'ics27-1',
      controller_connection_id: 'connection-0',
    },
  });
  assert.deepEqual(normalized.counterpartyVersion, { version: 'ics27-1' });
});

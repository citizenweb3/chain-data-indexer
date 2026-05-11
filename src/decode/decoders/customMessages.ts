import protobuf from 'protobufjs';
import { Any } from 'cosmjs-types/google/protobuf/any.js';
import { PubKey as Ed25519PubKey } from 'cosmjs-types/cosmos/crypto/ed25519/keys.js';
import { PubKey as Secp256k1PubKey } from 'cosmjs-types/cosmos/crypto/secp256k1/keys.js';
import { ClientUpdateProposal } from 'cosmjs-types/ibc/core/client/v1/client.js';
import { Acknowledgement as IbcAcknowledgement } from 'cosmjs-types/ibc/core/channel/v1/channel.js';
import { getLogger } from '../../utils/logger.ts';

const log = getLogger('decode/customMessages');
const strictUtf8Decoder = new TextDecoder('utf-8', { fatal: true });

const CONSUMER_KEY_TYPE_URLS = new Set([
  '/interchain_security.ccv.provider.v1.MsgAssignConsumerKey',
  '/interchain_security.ccv.provider.v1.MsgOptIn',
]);

const LIQUIDITY_TYPE_URLS = new Set([
  '/tendermint.liquidity.v1beta1.MsgCreatePool',
  '/tendermint.liquidity.v1beta1.MsgDepositWithinBatch',
  '/tendermint.liquidity.v1beta1.MsgWithdrawWithinBatch',
  '/tendermint.liquidity.v1beta1.MsgSwapWithinBatch',
]);

const PACKET_MESSAGE_TYPE_URLS = new Set([
  '/ibc.core.channel.v1.MsgRecvPacket',
  '/ibc.core.channel.v1.MsgTimeout',
  '/ibc.core.channel.v1.MsgAcknowledgement',
]);

const CHANNEL_VERSION_TYPE_URLS = new Set([
  '/ibc.core.channel.v1.MsgChannelOpenInit',
  '/ibc.core.channel.v1.MsgChannelOpenTry',
  '/ibc.core.channel.v1.MsgChannelOpenAck',
]);

const GOV_PROPOSAL_CONTENT_DECODERS: Record<string, (value: Uint8Array) => Record<string, unknown>> = {
  '/ibc.core.client.v1.ClientUpdateProposal': (value) => ({
    '@type': '/ibc.core.client.v1.ClientUpdateProposal',
    ...ClientUpdateProposal.toJSON(ClientUpdateProposal.decode(value)),
  }),
};

function readDelimitedFields(value: Uint8Array): Map<number, Uint8Array> {
  const reader = protobuf.Reader.create(value);
  const fields = new Map<number, Uint8Array>();

  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const fieldNumber = tag >>> 3;
    const wireType = tag & 7;

    if (wireType !== 2) {
      reader.skipType(wireType);
      continue;
    }

    const length = reader.uint32();
    const start = reader.pos;
    const end = start + length;
    fields.set(fieldNumber, reader.buf.subarray(start, end));
    reader.pos = end;
  }

  return fields;
}

function decodeUtf8Field(value?: Uint8Array): string {
  if (!value?.length) return '';
  return Buffer.from(value).toString('utf8');
}

function decodeCoin(value?: Uint8Array) {
  if (!value?.length) return { denom: '', amount: '' };

  const reader = protobuf.Reader.create(value);
  let denom = '';
  let amount = '';

  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const fieldNumber = tag >>> 3;

    switch (fieldNumber) {
      case 1:
        denom = reader.string();
        break;
      case 2:
        amount = reader.string();
        break;
      default:
        reader.skipType(tag & 7);
        break;
    }
  }

  return { denom, amount };
}

function tryDecodeJsonPayload(value: Uint8Array): unknown | undefined {
  try {
    return JSON.parse(strictUtf8Decoder.decode(value));
  } catch {
    return undefined;
  }
}

function looksLikeBase64(value: string): boolean {
  if (!value || value.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function decodeBase64Field(value: string): Uint8Array | undefined {
  if (!looksLikeBase64(value)) return undefined;
  return Buffer.from(value, 'base64');
}

function decodeBytesField(value: unknown): Uint8Array | undefined {
  if (!value) return undefined;
  if (value instanceof Uint8Array) return value;
  if (Buffer.isBuffer(value)) return new Uint8Array(value);
  if (typeof value === 'string') return decodeBase64Field(value);
  return undefined;
}

function decodeStructuredJsonString(value: unknown): unknown {
  if (typeof value !== 'string' || value.length === 0) return value;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeJsonBytes(value: unknown): unknown {
  const bytes = decodeBytesField(value);
  if (!bytes?.length) return value;

  return tryDecodeJsonPayload(bytes) ?? Buffer.from(bytes).toString('base64');
}

function normalizeAcknowledgementBytes(value: unknown): unknown {
  const bytes = decodeBytesField(value);
  if (!bytes?.length) return value;

  const jsonPayload = tryDecodeJsonPayload(bytes);
  if (jsonPayload !== undefined) return jsonPayload;

  try {
    return IbcAcknowledgement.toJSON(IbcAcknowledgement.decode(bytes));
  } catch {
    return Buffer.from(bytes).toString('base64');
  }
}

function normalizeKnownPubKey(typeUrl: string, value: Uint8Array): Record<string, string> | undefined {
  if (typeUrl === '/cosmos.crypto.ed25519.PubKey') {
    const pubKey = Ed25519PubKey.decode(value);
    return { '@type': typeUrl, key: Buffer.from(pubKey.key).toString('base64') };
  }

  if (typeUrl === '/cosmos.crypto.secp256k1.PubKey') {
    const pubKey = Secp256k1PubKey.decode(value);
    return { '@type': typeUrl, key: Buffer.from(pubKey.key).toString('base64') };
  }

  return undefined;
}

function normalizeConsumerKey(value?: Uint8Array): unknown {
  if (!value?.length) return '';

  const jsonPayload = tryDecodeJsonPayload(value);
  if (jsonPayload !== undefined) return jsonPayload;

  try {
    const anyMsg = Any.decode(value);
    if (!anyMsg.typeUrl) return Buffer.from(value).toString('base64');

    return (
      normalizeKnownPubKey(anyMsg.typeUrl, anyMsg.value) ?? {
        '@type': anyMsg.typeUrl,
        value_b64: Buffer.from(anyMsg.value).toString('base64'),
      }
    );
  } catch {
    log.warn('failed to normalize consumer_key payload, falling back to base64 wrapper');
    return {
      '@type': '/cdi.raw_bytes',
      value_b64: Buffer.from(value).toString('base64'),
    };
  }
}

function decodeConsumerKeyCarrier(typeUrl: string, value: Uint8Array) {
  const fields = readDelimitedFields(value);

  return {
    '@type': typeUrl,
    chainId: decodeUtf8Field(fields.get(1)),
    providerAddr: decodeUtf8Field(fields.get(2)),
    consumerKey: normalizeConsumerKey(fields.get(3)),
    signer: decodeUtf8Field(fields.get(4)),
    consumerId: decodeUtf8Field(fields.get(5)),
  };
}

function decodeLiquidityCreatePool(typeUrl: string, value: Uint8Array) {
  const reader = protobuf.Reader.create(value);
  let poolCreatorAddress = '';
  let poolTypeId = 0;
  const depositCoins: Array<{ denom: string; amount: string }> = [];

  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const fieldNumber = tag >>> 3;

    switch (fieldNumber) {
      case 1:
        poolCreatorAddress = reader.string();
        break;
      case 2:
        poolTypeId = reader.uint32();
        break;
      case 4:
        depositCoins.push(decodeCoin(reader.bytes()));
        break;
      default:
        reader.skipType(tag & 7);
        break;
    }
  }

  return {
    '@type': typeUrl,
    poolCreatorAddress,
    poolTypeId,
    depositCoins,
  };
}

function decodeLiquidityDeposit(typeUrl: string, value: Uint8Array) {
  const reader = protobuf.Reader.create(value);
  let depositorAddress = '';
  let poolId = '0';
  const depositCoins: Array<{ denom: string; amount: string }> = [];

  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const fieldNumber = tag >>> 3;

    switch (fieldNumber) {
      case 1:
        depositorAddress = reader.string();
        break;
      case 2:
        poolId = String(reader.uint64());
        break;
      case 3:
        depositCoins.push(decodeCoin(reader.bytes()));
        break;
      default:
        reader.skipType(tag & 7);
        break;
    }
  }

  return {
    '@type': typeUrl,
    depositorAddress,
    poolId,
    depositCoins,
  };
}

function decodeLiquidityWithdraw(typeUrl: string, value: Uint8Array) {
  const reader = protobuf.Reader.create(value);
  let withdrawerAddress = '';
  let poolId = '0';
  let poolCoin = { denom: '', amount: '' };

  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const fieldNumber = tag >>> 3;

    switch (fieldNumber) {
      case 1:
        withdrawerAddress = reader.string();
        break;
      case 2:
        poolId = String(reader.uint64());
        break;
      case 3:
        poolCoin = decodeCoin(reader.bytes());
        break;
      default:
        reader.skipType(tag & 7);
        break;
    }
  }

  return {
    '@type': typeUrl,
    withdrawerAddress,
    poolId,
    poolCoin,
  };
}

function decodeLiquiditySwap(typeUrl: string, value: Uint8Array) {
  const reader = protobuf.Reader.create(value);
  let swapRequesterAddress = '';
  let poolId = '0';
  let swapTypeId = 0;
  let offerCoin = { denom: '', amount: '' };
  let demandCoinDenom = '';
  let offerCoinFee = { denom: '', amount: '' };
  let orderPrice = '';

  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const fieldNumber = tag >>> 3;

    switch (fieldNumber) {
      case 1:
        swapRequesterAddress = reader.string();
        break;
      case 2:
        poolId = String(reader.uint64());
        break;
      case 3:
        swapTypeId = reader.uint32();
        break;
      case 4:
        offerCoin = decodeCoin(reader.bytes());
        break;
      case 5:
        demandCoinDenom = reader.string();
        break;
      case 6:
        offerCoinFee = decodeCoin(reader.bytes());
        break;
      case 7:
        orderPrice = reader.string();
        break;
      default:
        reader.skipType(tag & 7);
        break;
    }
  }

  return {
    '@type': typeUrl,
    swapRequesterAddress,
    poolId,
    swapTypeId,
    offerCoin,
    demandCoinDenom,
    offerCoinFee,
    orderPrice,
  };
}

function getUnresolvedAny(value: unknown): { typeUrl: string; value: unknown } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

  const maybeAny = value as Record<string, unknown>;
  const typeUrl = maybeAny.typeUrl ?? maybeAny.type_url;
  if (typeof typeUrl !== 'string' || !('value' in maybeAny)) return undefined;

  return { typeUrl, value: maybeAny.value };
}

function normalizeGovProposalContent(content: unknown): unknown {
  const unresolved = getUnresolvedAny(content);
  if (!unresolved) return content;

  const decoder = GOV_PROPOSAL_CONTENT_DECODERS[unresolved.typeUrl];
  if (!decoder) return content;

  const bytes = decodeBytesField(unresolved.value);
  if (!bytes?.length) return content;

  try {
    return decoder(bytes);
  } catch {
    log.warn(`failed to decode gov proposal content for ${unresolved.typeUrl}`);
    return content;
  }
}

function normalizePacketLikeMessage(message: Record<string, unknown>, typeUrl: string): Record<string, unknown> {
  const next = { ...message };
  const packet = next.packet;

  if (packet && typeof packet === 'object' && !Array.isArray(packet)) {
    const normalizedPacket = { ...(packet as Record<string, unknown>) };
    if ('data' in normalizedPacket) normalizedPacket.data = normalizeJsonBytes(normalizedPacket.data);
    next.packet = normalizedPacket;
  }

  if (typeUrl === '/ibc.core.channel.v1.MsgAcknowledgement' && 'acknowledgement' in next) {
    next.acknowledgement = normalizeAcknowledgementBytes(next.acknowledgement);
  }

  return next;
}

function normalizeChannelVersionMessage(message: Record<string, unknown>): Record<string, unknown> {
  const next = { ...message };
  const channel = next.channel;

  if (channel && typeof channel === 'object' && !Array.isArray(channel)) {
    const normalizedChannel = { ...(channel as Record<string, unknown>) };
    if ('version' in normalizedChannel) normalizedChannel.version = decodeStructuredJsonString(normalizedChannel.version);
    next.channel = normalizedChannel;
  }

  if ('counterpartyVersion' in next) next.counterpartyVersion = decodeStructuredJsonString(next.counterpartyVersion);
  if ('counterparty_version' in next) next.counterparty_version = decodeStructuredJsonString(next.counterparty_version);

  return next;
}

export function normalizeDecodedMessage(typeUrl: string, message: Record<string, unknown>): Record<string, unknown> {
  if (typeUrl === '/cosmos.gov.v1beta1.MsgSubmitProposal' && 'content' in message) {
    return { ...message, content: normalizeGovProposalContent(message.content) };
  }

  if (PACKET_MESSAGE_TYPE_URLS.has(typeUrl)) {
    return normalizePacketLikeMessage(message, typeUrl);
  }

  if (CHANNEL_VERSION_TYPE_URLS.has(typeUrl)) {
    return normalizeChannelVersionMessage(message);
  }

  return message;
}

export function decodeCustomMessage(typeUrl: string, value: Uint8Array): Record<string, unknown> | undefined {
  if (CONSUMER_KEY_TYPE_URLS.has(typeUrl)) {
    return decodeConsumerKeyCarrier(typeUrl, value);
  }

  if (LIQUIDITY_TYPE_URLS.has(typeUrl)) {
    switch (typeUrl) {
      case '/tendermint.liquidity.v1beta1.MsgCreatePool':
        return decodeLiquidityCreatePool(typeUrl, value);
      case '/tendermint.liquidity.v1beta1.MsgDepositWithinBatch':
        return decodeLiquidityDeposit(typeUrl, value);
      case '/tendermint.liquidity.v1beta1.MsgWithdrawWithinBatch':
        return decodeLiquidityWithdraw(typeUrl, value);
      case '/tendermint.liquidity.v1beta1.MsgSwapWithinBatch':
        return decodeLiquiditySwap(typeUrl, value);
      default:
        return undefined;
    }
  }

  return undefined;
}

// src/decode/decoders/tx.ts

/**
 * Module for decoding Cosmos SDK transactions into normalized JSON shapes.
 */
import Long from 'long';
import { decodeTxRaw } from '@cosmjs/proto-signing';
import { PubKey as PubKeySecp256k1 } from 'cosmjs-types/cosmos/crypto/secp256k1/keys.js';
import { TxBody, AuthInfo, Tx } from 'cosmjs-types/cosmos/tx/v1beta1/tx.js';
import { decodeAnyWithRoot } from '../dynamicProto.ts';
import { decodeKnown } from '../../generated/knownMsgs.ts';
import { getLogger } from '../../utils/logger.ts';
import { getProtoRoot, isProtoReady } from './context.ts';

const log = getLogger('decode/txWorker');

/**
 * Maps a list of coins into a snake-case JSON shape kept consistent across the project.
 * @param cs Optional array of coin objects with denom and amount properties.
 * @returns Array of coin objects with denom and amount in snake-case.
 */
function coinsToSnake(cs?: Array<{ denom: string; amount: string }>) {
  return (cs ?? []).map((c) => ({ denom: c.denom, amount: c.amount }));
}

/**
 * Decodes a single protobuf `Any` message with fast-path and dynamic fallbacks.
 * @param typeUrl The type URL of the message.
 * @param value The binary value of the message.
 * @returns The decoded message object.
 */
export function decodeMessage(typeUrl: string, value: Uint8Array): any {
  const fast = decodeKnown(typeUrl, value);
  if (fast) return { '@type': typeUrl, ...fast };

  if (isProtoReady()) {
    try {
      const root = getProtoRoot();
      return decodeAnyWithRoot(typeUrl, value, root);
    } catch {
      /* fall back to base64 */
    }
  }
  return { '@type': typeUrl, value_b64: Buffer.from(value).toString('base64') };
}

/**
 * Decodes `TxBody` bytes into normalized shape.
 * @param bodyBytes The protobuf-encoded TxBody bytes.
 * @returns The normalized transaction body object.
 */
export function decodeBodyToShape(bodyBytes: Uint8Array) {
  const body = TxBody.decode(bodyBytes);
  const messages = (body.messages ?? []).map((any) => decodeMessage(any.typeUrl, any.value));
  return {
    messages,
    memo: body.memo ?? '',
    timeout_height: (body.timeoutHeight ?? Long.UZERO).toString(),
    unordered: (body as any).unordered ?? false,
    timeout_timestamp: (body as any).timeoutTimestamp ?? null,
    extension_options: [],
    non_critical_extension_options: [],
  };
}

/**
 * Decodes `AuthInfo` bytes into normalized shape.
 * @param authBytes The protobuf-encoded AuthInfo bytes.
 * @returns The normalized auth info object.
 */
export function decodeAuthInfoToShape(authBytes: Uint8Array) {
  const ai = AuthInfo.decode(authBytes);

  const signer_infos = (ai.signerInfos ?? []).map((si) => {
    let public_key: any = undefined;
    if (si.publicKey?.typeUrl === '/cosmos.crypto.secp256k1.PubKey') {
      const pk = PubKeySecp256k1.decode(si.publicKey.value);
      public_key = { '@type': '/cosmos.crypto.secp256k1.PubKey', key: Buffer.from(pk.key).toString('base64') };
    } else if (si.publicKey) {
      public_key = { '@type': si.publicKey.typeUrl, value: Buffer.from(si.publicKey.value).toString('base64') };
    }

    let mode_info: any = undefined;
    if (si.modeInfo?.single) mode_info = { single: { mode: 'SIGN_MODE_DIRECT' } };
    else if (si.modeInfo?.multi) mode_info = { multi: {} };

    return {
      public_key,
      mode_info,
      sequence: (si.sequence ?? Long.UZERO).toString(),
    };
  });

  const fee = ai.fee
    ? {
        amount: coinsToSnake(ai.fee.amount as any),
        gas_limit: (ai.fee.gasLimit ?? Long.UZERO).toString(),
        payer: ai.fee.payer ?? '',
        granter: ai.fee.granter ?? '',
      }
    : { amount: [], gas_limit: '0', payer: '', granter: '' };

  return { signer_infos, fee, tip: (ai as any).tip ?? null };
}

/**
 * Decodes a base64-encoded Cosmos SDK transaction into normalized JSON representation.
 * @param base64 The base64-encoded transaction string.
 * @returns The decoded transaction object including body, auth_info, and signatures.
 */
export function decodeTxBase64(base64: string) {
  const txBytes = Buffer.from(base64, 'base64');

  let bodyBytes: Uint8Array | undefined;
  let authInfoBytes: Uint8Array | undefined;
  let sigs: Uint8Array[] | undefined;

  try {
    const txRaw = decodeTxRaw(txBytes);
    bodyBytes = txRaw.bodyBytes;
    authInfoBytes = txRaw.authInfoBytes;
    sigs = txRaw.signatures;
  } catch {
    /* noop */
  }

  if (!bodyBytes || bodyBytes.length === 0) {
    try {
      const full = Tx.decode(txBytes);
      const body = full.body ? TxBody.encode(full.body).finish() : new Uint8Array();
      const auth = full.authInfo ? AuthInfo.encode(full.authInfo).finish() : new Uint8Array();
      bodyBytes = body;
      authInfoBytes = auth;
      sigs = (full.signatures ?? []) as unknown as Uint8Array[];
    } catch {
      /* noop */
    }
  }

  if (!bodyBytes || bodyBytes.length === 0 || !authInfoBytes) {
    const hexPrefix = Buffer.from(txBytes.slice(0, 8)).toString('hex').toUpperCase();
    log.warn(`[txWorker] cannot decode body/auth; len=${txBytes.length}, head=${hexPrefix}`);
    return {
      '@type': '/cosmos.tx.v1beta1.Tx',
      body: {
        messages: [],
        memo: '',
        timeout_height: '0',
        unordered: false,
        timeout_timestamp: null,
        extension_options: [],
        non_critical_extension_options: [],
      },
      auth_info: { signer_infos: [], fee: { amount: [], gas_limit: '0', payer: '', granter: '' }, tip: null },
      signatures: [],
    };
  }

  const body = decodeBodyToShape(bodyBytes);
  const auth_info = decodeAuthInfoToShape(authInfoBytes);
  const signatures = (sigs ?? []).map((s) => Buffer.from(s).toString('base64'));

  return {
    '@type': '/cosmos.tx.v1beta1.Tx',
    body,
    auth_info,
    signatures,
  };
}

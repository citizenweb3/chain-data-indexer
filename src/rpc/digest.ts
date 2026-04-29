export type FeltTuple = readonly [bigint | number | string, bigint | number | string, bigint | number | string, bigint | number | string];

const FELT_BYTE_LENGTH = 8;
export const DIGEST_BYTE_LENGTH = 32;
export const ACCOUNT_ID_BYTE_LENGTH = 15;

function toUInt64(value: bigint | number | string): bigint {
  const bigintValue = typeof value === 'bigint' ? value : BigInt(value);
  if (bigintValue < 0n || bigintValue > 0xffff_ffff_ffff_ffffn) {
    throw new RangeError(`felt value out of uint64 range: ${value.toString()}`);
  }
  return bigintValue;
}

/**
 * Converts Miden's proto Digest felt tuple into bytes.
 *
 * The proto exposes a digest as four fixed64 field elements (d0..d3). We store
 * each field element as unsigned little-endian u64 and concatenate d0, d1, d2,
 * d3. This preserves the tuple losslessly and matches Miden's word/felt binary
 * convention used by winter_utils serialization.
 */
export function digestFromFelts(felts: FeltTuple): Buffer {
  const digest = Buffer.alloc(DIGEST_BYTE_LENGTH);
  felts.forEach((felt, index) => {
    digest.writeBigUInt64LE(toUInt64(felt), index * FELT_BYTE_LENGTH);
  });
  return digest;
}

/** Reverse of digestFromFelts(); returns d0..d3 as bigint values. */
export function feltsFromDigest(digest: Buffer): readonly [bigint, bigint, bigint, bigint] {
  if (digest.length !== DIGEST_BYTE_LENGTH) {
    throw new RangeError(`digest must be ${DIGEST_BYTE_LENGTH} bytes, got ${digest.length}`);
  }
  return [
    digest.readBigUInt64LE(0),
    digest.readBigUInt64LE(8),
    digest.readBigUInt64LE(16),
    digest.readBigUInt64LE(24),
  ];
}

export function wireDigestFromBuffer(digest: Buffer): { d0: string; d1: string; d2: string; d3: string } {
  const [d0, d1, d2, d3] = feltsFromDigest(digest);
  return { d0: d0.toString(), d1: d1.toString(), d2: d2.toString(), d3: d3.toString() };
}

export function accountIdToHex(accountId: Buffer): string {
  if (accountId.length !== ACCOUNT_ID_BYTE_LENGTH) {
    throw new RangeError(`account ID must be ${ACCOUNT_ID_BYTE_LENGTH} bytes, got ${accountId.length}`);
  }
  return accountId.toString('hex');
}

export function accountIdFromHex(hex: string): Buffer {
  const normalized = hex.startsWith('0x') ? hex.slice(2) : hex;
  const accountId = Buffer.from(normalized, 'hex');
  if (accountId.length !== ACCOUNT_ID_BYTE_LENGTH) {
    throw new RangeError(`account ID hex must decode to ${ACCOUNT_ID_BYTE_LENGTH} bytes, got ${accountId.length}`);
  }
  return accountId;
}

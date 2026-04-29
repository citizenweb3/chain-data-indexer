import { performance } from 'node:perf_hooks';
import { createMidenRpcClient } from '../src/rpc/client.js';
import { accountIdToHex, digestFromFelts, feltsFromDigest } from '../src/rpc/digest.js';

type AsyncCall<T> = () => Promise<T>;

async function timed<T>(method: string, call: AsyncCall<T>, summarize: (response: T) => string): Promise<T> {
  const start = performance.now();
  const response = await call();
  const latency = Math.round(performance.now() - start);
  console.log(`OK | ${method} | ${latency} | ${summarize(response)}`);
  return response;
}

function assertDigestRoundTrip(): void {
  const captured = digestFromFelts([
    '3927611849750685065',
    '12513777742572208837',
    '15527706889649545347',
    '10189565380207197507',
  ]);
  const roundTripped = digestFromFelts(feltsFromDigest(captured));
  if (!captured.equals(roundTripped)) {
    throw new Error('digest felt tuple round-trip failed');
  }
  console.log(`OK | digestRoundTrip | 0 | bytes=${roundTripped.length}`);
}

async function main(): Promise<void> {
  assertDigestRoundTrip();

  const client = createMidenRpcClient({ url: 'http://127.0.0.1:57291', requestTimeoutMs: 15_000 });
  try {
    const status = await timed('status', () => client.status(), (response) => {
      const storeTip = response.store?.chainTip ?? 0;
      const producerTip = response.blockProducer?.chainTip ?? 0;
      return `version=${response.version} store_tip=${storeTip} producer_tip=${producerTip}`;
    });

    await timed('getLimits', () => client.getLimits(), (response) => `endpoints=${Object.keys(response.endpoints).length}`);

    const latestHeader = await timed('getBlockHeaderByNumber', () => client.getBlockHeaderByNumber('latest'), (response) => {
      const blockNum = response.blockHeader?.blockNum ?? 0;
      return `block_num=${blockNum}`;
    });

    const latestBlockNum = latestHeader.blockHeader?.blockNum ?? status.store?.chainTip ?? status.blockProducer?.chainTip ?? 0;
    await timed('getBlockByNumber', () => client.getBlockByNumber(latestBlockNum), (response) => `bytes=${response.block?.length ?? 0}`);

    await timed('getNotesById', () => client.getNotesById([]), (response) => `notes=${response.notes.length}`);

    await timed('checkNullifiers', () => client.checkNullifiers([]), (response) => `proofs=${response.proofs.length}`);

    const accountId = latestHeader.blockHeader?.feeParameters?.nativeAssetId ?? Buffer.alloc(15);
    await timed('getAccount', () => client.getAccount(accountId), (response) => {
      const blockNum = response.blockNum?.blockNum ?? 0;
      const witnessId = response.witness ? accountIdToHex(response.witness.witnessId) : 'none';
      return `account=${accountIdToHex(accountId)} block_num=${blockNum} witness=${witnessId}`;
    });
  } finally {
    client.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

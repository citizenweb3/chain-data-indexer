import { config } from '../config.js';
import { fetchBlockHeaderByHeight, fetchCoinbaseTxSum } from '../rpc/client.js';
import { deleteSupplyCheckpointsAbove, getLatestSupplyCheckpoint, upsertSupplyCheckpoint } from '../sink/postgres.js';
import { logger } from '../utils/logger.js';

async function getLatestValidCheckpoint(targetHeight: number) {
  let checkpoint = await getLatestSupplyCheckpoint(targetHeight);

  while (checkpoint) {
    const header = await fetchBlockHeaderByHeight(checkpoint.height, 10_000, 1);
    if (header.hash === checkpoint.block_hash) {
      return checkpoint;
    }

    const deleted = await deleteSupplyCheckpointsAbove(checkpoint.height - 1);
    logger.warn('Deleted Monero supply checkpoints after reorg mismatch', {
      invalid_height: checkpoint.height,
      invalid_hash: checkpoint.block_hash,
      current_hash: header.hash,
      deleted_rows: deleted,
    });
    checkpoint = await getLatestSupplyCheckpoint(targetHeight);
  }

  return null;
}

export async function ensureSupplyBackfillUpTo(targetHeight: number): Promise<number> {
  if (targetHeight < 0) return 0;

  let checkpoint = await getLatestValidCheckpoint(targetHeight);
  let cumulativeEmission = checkpoint ? BigInt(checkpoint.cumulative_emission_atomic) : 0n;
  let cumulativeFee = checkpoint ? BigInt(checkpoint.cumulative_fee_atomic) : 0n;
  let startHeight = checkpoint ? checkpoint.height + 1 : 0;
  let written = 0;

  while (startHeight <= targetHeight) {
    const count = Math.min(config.SUPPLY_CHUNK_SIZE, targetHeight - startHeight + 1);
    const chunkEnd = startHeight + count - 1;
    const sum = await fetchCoinbaseTxSum(startHeight, count);
    cumulativeEmission += BigInt(String(sum.emission_amount));
    cumulativeFee += BigInt(String(sum.fee_amount));

    const header = await fetchBlockHeaderByHeight(chunkEnd, 10_000, 1);
    await upsertSupplyCheckpoint({
      height: chunkEnd,
      block_hash: header.hash,
      block_timestamp: header.timestamp,
      cumulative_emission_atomic: cumulativeEmission.toString(),
      cumulative_fee_atomic: cumulativeFee.toString(),
      source_method: startHeight === 0 ? 'rpc:get_coinbase_tx_sum:bootstrap' : 'rpc:get_coinbase_tx_sum:incremental',
    });

    logger.info('Monero supply checkpoint written', {
      from_height: startHeight,
      to_height: chunkEnd,
      cumulative_emission_atomic: cumulativeEmission.toString(),
    });

    checkpoint = {
      height: chunkEnd,
      block_hash: header.hash,
      block_timestamp: header.timestamp,
      cumulative_emission_atomic: cumulativeEmission.toString(),
      cumulative_fee_atomic: cumulativeFee.toString(),
      source_method: 'rpc:get_coinbase_tx_sum:incremental',
      computed_at: new Date(),
    };
    startHeight = chunkEnd + 1;
    written++;
  }

  return written;
}

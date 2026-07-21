import { type TransferRow, type TransfersByAddressCursor, queryTransfersByAddress } from '@/queries/transfers-queries';

export interface TransferDto {
  height: string;
  tx_hash: string;
  msg_index: number;
  from_addr: string;
  to_addr: string;
  denom: string;
  amount: string;
  time: string;
}

export interface TransfersByAddressResult {
  data: TransferDto[];
  cursor: {
    next_before_height: string;
    next_before_tx_hash: string;
    next_before_msg_index: number;
    next_before_from: string;
    next_before_to: string;
    next_before_denom: string;
  } | null;
  has_more: boolean;
}

const toTransferDto = (row: TransferRow): TransferDto => ({
  height: row.height.toString(),
  tx_hash: row.tx_hash,
  msg_index: row.msg_index,
  from_addr: row.from_addr,
  to_addr: row.to_addr,
  denom: row.denom,
  amount: row.amount,
  time: row.time.toISOString(),
});

export async function listTransfersByAddress(
  addresses: string[],
  limit: number,
  cursor?: TransfersByAddressCursor,
): Promise<TransfersByAddressResult> {
  const rows = await queryTransfersByAddress({ addresses, limit, cursor });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const last = page.at(-1);
  const nextCursor =
    hasMore && last !== undefined
      ? {
          next_before_height: last.height.toString(),
          next_before_tx_hash: last.tx_hash,
          next_before_msg_index: last.msg_index,
          next_before_from: last.from_addr,
          next_before_to: last.to_addr,
          next_before_denom: last.denom,
        }
      : null;

  return { data: page.map(toTransferDto), cursor: nextCursor, has_more: hasMore };
}

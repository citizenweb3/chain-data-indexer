/**
 * Wire DTOs of the upstream `indexer-ibc-api` service.
 *
 * Shared with `src/services/transfers-service.ts` (api-dev) — any change here must
 * be coordinated. All numeric fields that would overflow JS `number` are serialized
 * as decimal strings by the upstream and stay strings here.
 */

export type IbcTransferStatus = 'sent' | 'received' | 'acknowledged' | 'timeout' | 'failed';

export type IbcTransferDirection = 'outgoing' | 'incoming';

export type IbcTransferDto = {
  port_id_src: string;
  channel_id_src: string;
  sequence: string;

  port_id_dst: string | null;
  channel_id_dst: string | null;

  status: IbcTransferStatus;
  direction: IbcTransferDirection;

  event_height: string | null;
  event_time: string | null;

  tx_hash_send: string | null;
  height_send: string | null;
  tx_hash_recv: string | null;
  height_recv: string | null;
  tx_hash_ack: string | null;
  height_ack: string | null;

  denom: string | null;
  amount: string | null;
  memo: string | null;
  relayer: string | null;

  timeout_height: string | null;
  timeout_ts: string | null;
};

export type IbcTransferCursor = {
  next_before_height: string | null;
  next_before_sequence: string;
  next_before_channel: string;
  next_before_port: string;
};

export type IbcTransfersListResponse = {
  data: IbcTransferDto[];
  cursor: IbcTransferCursor | null;
  has_more: boolean;
  total: string;
};

export type UpstreamHealthResponse = {
  ok: boolean;
};

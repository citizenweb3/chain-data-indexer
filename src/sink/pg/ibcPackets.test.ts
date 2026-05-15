import assert from 'node:assert/strict';
import test from 'node:test';
import { attrsToPairs } from './parsing.ts';
import { dedupeIbcPacketRows, extractIbcPacketRow } from './ibcPackets.ts';

test('extractIbcPacketRow parses send_packet ICS-20 packet_data', () => {
  const row = extractIbcPacketRow(
    attrsToPairs({
      packet_src_port: 'transfer',
      packet_src_channel: 'channel-141',
      packet_sequence: '4823',
      packet_dst_port: 'transfer',
      packet_dst_channel: 'channel-0',
      packet_timeout_height: '0-23457000',
      packet_timeout_timestamp: '1747300000000000000',
      packet_data: JSON.stringify({
        denom: 'uatom',
        amount: '1000000',
        sender: 'cosmos1sender',
        receiver: 'osmo1receiver',
        memo: 'memo',
      }),
    }),
    {
      eventType: 'send_packet',
      height: 23456789,
      txHash: 'ABC123',
      relayer: 'cosmos1relayer',
    },
  );

  assert.deepEqual(row, {
    port_id_src: 'transfer',
    channel_id_src: 'channel-141',
    sequence: 4823n,
    port_id_dst: 'transfer',
    channel_id_dst: 'channel-0',
    timeout_height: '0-23457000',
    timeout_ts: 1747300000000000000n,
    status: 'sent',
    tx_hash_send: 'ABC123',
    height_send: 23456789,
    tx_hash_recv: null,
    height_recv: null,
    tx_hash_ack: null,
    height_ack: null,
    relayer: null,
    denom: 'uatom',
    amount: '1000000',
    memo: 'memo',
  });
});

test('dedupeIbcPacketRows merges lifecycle rows without downgrading terminal status', () => {
  const send = extractIbcPacketRow(
    attrsToPairs({
      packet_src_port: 'transfer',
      packet_src_channel: 'channel-141',
      packet_sequence: '4823',
      packet_data: '{"denom":"uatom","amount":"1000000"}',
    }),
    { eventType: 'send_packet', height: 10, txHash: 'SEND', relayer: null },
  );
  const ack = extractIbcPacketRow(
    attrsToPairs({
      packet_src_port: 'transfer',
      packet_src_channel: 'channel-141',
      packet_sequence: '4823',
      packet_ack: '{"error":"failed"}',
    }),
    { eventType: 'acknowledge_packet', height: 12, txHash: 'ACK', relayer: 'cosmos1relayer' },
  );
  const recv = extractIbcPacketRow(
    attrsToPairs({
      packet_src_port: 'transfer',
      packet_src_channel: 'channel-141',
      packet_sequence: '4823',
    }),
    { eventType: 'recv_packet', height: 11, txHash: 'RECV', relayer: 'cosmos1relayer' },
  );

  assert.ok(send);
  assert.ok(ack);
  assert.ok(recv);

  const rows = dedupeIbcPacketRows([send, ack, recv]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.status, 'failed');
  assert.equal(rows[0]?.tx_hash_send, 'SEND');
  assert.equal(rows[0]?.tx_hash_ack, 'ACK');
  assert.equal(rows[0]?.tx_hash_recv, 'RECV');
  assert.equal(rows[0]?.denom, 'uatom');
  assert.equal(rows[0]?.amount, '1000000');
});

test('extractIbcPacketRow ignores timeout timestamps that exceed PostgreSQL bigint', () => {
  const row = extractIbcPacketRow(
    attrsToPairs({
      packet_src_port: 'transfer',
      packet_src_channel: 'channel-0',
      packet_sequence: '145672',
      packet_timeout_timestamp: '13018349317287346176',
    }),
    { eventType: 'recv_packet', height: 30691875, txHash: 'RECV', relayer: 'cosmos1relayer' },
  );

  assert.ok(row);
  assert.equal(row.timeout_ts, null);
});

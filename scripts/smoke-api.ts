import { once } from 'node:events';
import type http from 'node:http';
import { createApiServer } from '../src/api.js';
import { closePool, getPool } from '../src/db/pg.js';

type SampleRow = Record<string, string | null>;

interface SmokeEndpoint {
  name: string;
  path: string;
  allowed: Set<number>;
}

function listen(server: http.Server): Promise<number> {
  server.listen(0, '127.0.0.1');
  return once(server, 'listening').then(() => {
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('expected TCP listener');
    return address.port;
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function sample(sql: string): Promise<SampleRow> {
  const { rows } = await getPool().query<SampleRow>(sql);
  return rows[0] ?? {};
}

async function assertEndpoint(baseUrl: string, endpoint: SmokeEndpoint): Promise<string> {
  const response = await fetch(`${baseUrl}${endpoint.path}`);
  if (!endpoint.allowed.has(response.status)) {
    const body = await response.text();
    throw new Error(`${endpoint.name} returned ${response.status}: ${body}`);
  }
  await response.arrayBuffer();
  return `${endpoint.name} ${response.status}`;
}

async function main(): Promise<void> {
  const server = createApiServer(() => null);
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const block = await sample("SELECT block_num::text, encode(block_hash, 'hex') AS block_hash FROM miden_blocks ORDER BY block_num DESC LIMIT 1");
    const tx = await sample("SELECT encode(tx_id, 'hex') AS tx_id, block_num::text, encode(account_id, 'hex') AS account_id FROM miden_transactions ORDER BY block_num DESC LIMIT 1");
    const note = await sample("SELECT encode(note_id, 'hex') AS note_id, block_num::text, encode(sender, 'hex') AS sender, tag::text, is_public::text FROM miden_notes ORDER BY block_num DESC LIMIT 1");
    const nullifier = await sample("SELECT encode(nullifier, 'hex') AS nullifier, block_num::text FROM miden_nullifiers ORDER BY block_num DESC LIMIT 1");
    const account = await sample("SELECT encode(account_id, 'hex') AS account_id, is_public::text FROM miden_accounts ORDER BY last_block_num DESC LIMIT 1");

    const blockNum = block.block_num ?? '0';
    const blockHash = block.block_hash ?? '00'.repeat(32);
    const txId = tx.tx_id ?? '11'.repeat(32);
    const txListQuery = tx.block_num && tx.account_id
      ? `?limit=1&offset=0&block_num=${tx.block_num}&account_id=${tx.account_id}`
      : '?limit=1&offset=0';
    const noteId = note.note_id ?? '22'.repeat(32);
    const noteListQuery = note.block_num
      ? `?limit=1&offset=0&block_num=${note.block_num}${note.sender ? `&sender_hex=${note.sender}` : ''}${note.tag ? `&tag=${note.tag}` : ''}${note.is_public ? `&is_public=${note.is_public}` : ''}`
      : '?limit=1&offset=0';
    const nullifierHex = nullifier.nullifier ?? '33'.repeat(32);
    const nullifierListQuery = nullifier.block_num ? `?limit=1&offset=0&block_num=${nullifier.block_num}` : '?limit=1&offset=0';
    const accountId = account.account_id ?? '44'.repeat(15);
    const accountListQuery = account.is_public ? `?limit=1&offset=0&is_public=${account.is_public}` : '?limit=1&offset=0';

    const endpoints: SmokeEndpoint[] = [
      { name: 'health', path: '/health', allowed: new Set([200]) },
      { name: 'stats', path: '/api/v1/stats', allowed: new Set([200]) },
      { name: 'blocks-list', path: '/api/v1/blocks?limit=1&offset=0&order=desc', allowed: new Set([200]) },
      { name: 'block-by-number', path: `/api/v1/blocks/${blockNum}`, allowed: new Set([200, 404]) },
      { name: 'block-by-hash', path: `/api/v1/blocks/by-hash/${blockHash}`, allowed: new Set([200, 404]) },
      { name: 'transactions-list', path: `/api/v1/transactions${txListQuery}`, allowed: new Set([200]) },
      { name: 'transaction-detail', path: `/api/v1/transactions/${txId}`, allowed: new Set([200, 404]) },
      { name: 'notes-list', path: `/api/v1/notes${noteListQuery}`, allowed: new Set([200]) },
      { name: 'note-detail', path: `/api/v1/notes/${noteId}`, allowed: new Set([200, 404]) },
      { name: 'nullifiers-list', path: `/api/v1/nullifiers${nullifierListQuery}`, allowed: new Set([200]) },
      { name: 'nullifier-detail', path: `/api/v1/nullifiers/${nullifierHex}`, allowed: new Set([200, 404]) },
      { name: 'accounts-list', path: `/api/v1/accounts${accountListQuery}`, allowed: new Set([200]) },
      { name: 'account-detail', path: `/api/v1/accounts/${accountId}`, allowed: new Set([200, 404]) },
      { name: 'bad-block-hash', path: '/api/v1/blocks/by-hash/not-hex', allowed: new Set([400]) },
    ];

    const results: string[] = [];
    for (const endpoint of endpoints) {
      results.push(await assertEndpoint(baseUrl, endpoint));
    }
    console.log(`smoke-api ok: ${results.join(', ')}`);
  } finally {
    await closeServer(server);
    await closePool();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

# logos-indexer

Block indexer for the [Logos Blockchain](https://github.com/logos-blockchain/logos-blockchain) testnet.

Indexes all blocks and validator (leader) statistics from a local Logos node into PostgreSQL.
Designed for integration with the [validatorinfo](https://validatorinfo.com) explorer.

**Supported:** Logos testnet v0.1.2+

---

## What it indexes

| Data | Source | Table |
|---|---|---|
| All blocks (slot, height, leader, raw JSON) | `/cryptarchia/blocks` | `logos_blocks` |
| Validator stats (blocks produced, first/last slot) | `proof_of_leadership.leader_key` | `logos_leaders` |
| Indexer resume position | internal | `logos_indexer_progress` |

Transactions and wallet balances are not indexed in v0.1.2 — see [`docs/future.md`](docs/future.md).

---

## Prerequisites

- Node.js ≥ 20 with npm
- PostgreSQL ≥ 14
- A running Logos node (v0.1.2 testnet) accessible at `NODE_URL`

---

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Configure
cp .env.example .env
# Edit .env: set PG_PASSWORD and NODE_URL

# 3. Initialise database
psql "postgresql://$PG_USER:$PG_PASSWORD@$PG_HOST:$PG_PORT/$PG_DB" -f initdb/001-schema.sql

# 4. Run (dev mode)
npm run dev

# 5. Build and run (production)
npm run build
npm start
```

### With Docker Compose

```bash
cp .env.example .env   # set PG_PASSWORD
docker compose up -d
```

---

## Configuration

See [`.env.example`](.env.example) for all options.

| Variable | Default | Description |
|---|---|---|
| `NODE_URL` | `http://localhost:8080` | Logos node HTTP API |
| `PG_*` | see .env.example | PostgreSQL connection |
| `FROM_SLOT` | `0` | Start slot (overridden by saved progress) |
| `FOLLOW` | `true` | Subscribe to live blocks after backfill |
| `BATCH_SIZE` | `500` | Slots per backfill request |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

---

## Architecture

```
src/
├── index.ts             Entry point: wait for Online → backfill → follow
├── config.ts            Env-based config (zod)
├── types.d.ts           Logos API types
├── rpc/client.ts        HTTP client for Logos node REST + SSE
├── db/
│   ├── pg.ts            PostgreSQL pool
│   └── progress.ts      Resume: last indexed slot
├── sink/postgres.ts     Upsert blocks, leaders
└── runner/
    ├── syncRange.ts     Slot-range backfill with resume
    └── follow.ts        SSE stream follower
```

---

## Explorer queries

```sql
-- Latest blocks
SELECT slot, height, leader_key, tx_count, indexed_at
FROM logos_blocks ORDER BY slot DESC LIMIT 20;

-- Top validators by blocks produced
SELECT leader_key, blocks_produced, first_block_slot, last_block_slot
FROM logos_leaders ORDER BY blocks_produced DESC LIMIT 20;

-- Network summary
SELECT COUNT(*) AS total_blocks, MAX(slot) AS latest_slot, MAX(height) AS latest_height
FROM logos_blocks;
```

---

## Future work

See [`docs/future.md`](docs/future.md) for the v0.2+ roadmap:
- Transaction indexing (when `block.transactions[]` becomes non-empty)
- UTXO note tracking
- Wallet balance display (pending public API support)

---

## Agent workflow

See [`AGENTS.md`](AGENTS.md) for sub-agent roles and constraints when working on this codebase.

-- CreateTable
CREATE TABLE "ibc_packets" (
    "channel_id_src" TEXT NOT NULL,
    "port_id_src" TEXT NOT NULL,
    "sequence" BIGINT NOT NULL,
    "port_id_dst" TEXT,
    "channel_id_dst" TEXT,
    "status" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "event_height" BIGINT,
    "event_time" TIMESTAMP(3),
    "tx_hash_send" TEXT,
    "height_send" BIGINT,
    "tx_hash_recv" TEXT,
    "height_recv" BIGINT,
    "tx_hash_ack" TEXT,
    "height_ack" BIGINT,
    "denom" TEXT,
    "amount" DECIMAL(80,0),
    "memo" TEXT,
    "relayer" TEXT,
    "timeout_height" TEXT,
    "timeout_ts" BIGINT,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ibc_packets_pkey" PRIMARY KEY ("channel_id_src","port_id_src","sequence")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" SERIAL NOT NULL,
    "symbol" TEXT NOT NULL,
    "coingecko_id" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL,
    "native_denom" TEXT NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prices" (
    "id" SERIAL NOT NULL,
    "asset_id" INTEGER NOT NULL,
    "usd" DECIMAL(20,8) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_history" (
    "asset_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "usd" DECIMAL(20,8) NOT NULL,

    CONSTRAINT "price_history_pkey" PRIMARY KEY ("asset_id","date")
);

-- CreateTable
CREATE TABLE "ibc_daily_stats" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "channel_id_src" TEXT,
    "direction" TEXT NOT NULL,
    "denom" TEXT,
    "transfers_count" BIGINT NOT NULL,
    "amount_native" DECIMAL(80,0),
    "amount_usd" DECIMAL(30,8),
    "recomputed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ibc_daily_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_cursors" (
    "key" TEXT NOT NULL,
    "last_event_height" BIGINT,
    "last_sequence" BIGINT,
    "last_channel" TEXT,
    "last_port" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_cursors_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "ibc_packets_event_time_idx" ON "ibc_packets"("event_time" DESC);

-- CreateIndex
CREATE INDEX "ibc_packets_channel_id_src_direction_event_time_idx" ON "ibc_packets"("channel_id_src", "direction", "event_time" DESC);

-- CreateIndex
CREATE INDEX "ibc_packets_denom_event_time_idx" ON "ibc_packets"("denom", "event_time" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "assets_symbol_key" ON "assets"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "assets_native_denom_key" ON "assets"("native_denom");

-- CreateIndex
CREATE INDEX "prices_asset_id_created_at_idx" ON "prices"("asset_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ibc_daily_stats_date_idx" ON "ibc_daily_stats"("date");

-- CreateIndex
-- NULLS NOT DISTINCT so that rows with NULL channel_id_src/denom (rollup levels) collide on conflict.
-- Required for ON CONFLICT in recompute-daily-stats; Postgres 15+ supports NULLS NOT DISTINCT natively.
CREATE UNIQUE INDEX "ibc_daily_stats_dim_uniq" ON "ibc_daily_stats"("date", "channel_id_src", "direction", "denom") NULLS NOT DISTINCT;

-- AddForeignKey
ALTER TABLE "prices" ADD CONSTRAINT "prices_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ibc_channels" (
    "channel_id_src" TEXT NOT NULL,
    "port_id_src" TEXT NOT NULL,
    "counterparty_chain_id" TEXT NOT NULL,
    "counterparty_chain_name" TEXT NOT NULL,
    "counterparty_channel_id" TEXT,
    "counterparty_port_id" TEXT,
    "client_id" TEXT,
    "status" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ibc_channels_pkey" PRIMARY KEY ("channel_id_src", "port_id_src")
);

-- CreateIndex
CREATE INDEX "ibc_channels_counterparty_chain_id_idx" ON "ibc_channels"("counterparty_chain_id");

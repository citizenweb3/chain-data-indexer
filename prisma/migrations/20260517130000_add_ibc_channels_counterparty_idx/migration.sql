-- CreateIndex
CREATE INDEX "ibc_channels_counterparty_channel_idx"
  ON "ibc_channels"("counterparty_channel_id", "counterparty_port_id");

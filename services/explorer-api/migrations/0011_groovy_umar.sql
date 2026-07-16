DROP TABLE IF EXISTS "content_commitment";--> statement-breakpoint
DROP TABLE IF EXISTS "tx_public_call_request";--> statement-breakpoint
ALTER TABLE "tx_effect" ALTER COLUMN "tx_time_of_birth" SET DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000;--> statement-breakpoint
ALTER TABLE "header" ALTER COLUMN "total_fees" SET DATA TYPE numeric(77, 0);--> statement-breakpoint
ALTER TABLE "header" ALTER COLUMN "total_mana_used" SET DATA TYPE numeric(77, 0);--> statement-breakpoint
ALTER TABLE "l1_l2_validator_proposer" ALTER COLUMN "timestamp" SET DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000;--> statement-breakpoint
ALTER TABLE "l1_l2_validator_rollup_address" ALTER COLUMN "timestamp" SET DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000;--> statement-breakpoint
ALTER TABLE "l1_l2_validator_stake" ALTER COLUMN "timestamp" SET DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000;--> statement-breakpoint
ALTER TABLE "l1_l2_validator_status" ALTER COLUMN "timestamp" SET DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000;--> statement-breakpoint
ALTER TABLE "l1_l2_validator_withdrawer" ALTER COLUMN "timestamp" SET DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000;--> statement-breakpoint
ALTER TABLE "l2BlockFinalizationStatus" ALTER COLUMN "timestamp" SET DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000;--> statement-breakpoint
ALTER TABLE "header" ADD COLUMN IF NOT EXISTS "sponge_blob_hash" varchar(66) NOT NULL;

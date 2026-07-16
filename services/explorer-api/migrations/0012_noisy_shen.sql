ALTER TABLE "l2_contract_instance_deployed" ADD COLUMN "npkMHash" varchar(66);--> statement-breakpoint
ALTER TABLE "l2_contract_instance_deployed" ADD COLUMN "ivpkM" varchar(130);--> statement-breakpoint
ALTER TABLE "l2_contract_instance_deployed" ADD COLUMN "ovpkMHash" varchar(66);--> statement-breakpoint
ALTER TABLE "l2_contract_instance_deployed" ADD COLUMN "tpkMHash" varchar(66);--> statement-breakpoint
ALTER TABLE "l2_contract_instance_deployed" ADD COLUMN "mspkMHash" varchar(66);--> statement-breakpoint
ALTER TABLE "l2_contract_instance_deployed" ADD COLUMN "fbpkMHash" varchar(66);--> statement-breakpoint
ALTER TABLE "l2_contract_instance_deployed" ADD COLUMN "immutablesHash" varchar(66);--> statement-breakpoint
ALTER TABLE "l2_contract_instance_deployed" DROP COLUMN IF EXISTS "masterNullifierPublicKey";--> statement-breakpoint
ALTER TABLE "l2_contract_instance_deployed" DROP COLUMN IF EXISTS "masterIncomingViewingPublicKey";--> statement-breakpoint
ALTER TABLE "l2_contract_instance_deployed" DROP COLUMN IF EXISTS "masterOutgoingViewingPublicKey";--> statement-breakpoint
ALTER TABLE "l2_contract_instance_deployed" DROP COLUMN IF EXISTS "masterTaggingPublicKey";

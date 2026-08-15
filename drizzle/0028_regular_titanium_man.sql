CREATE TYPE "public"."retainer_status" AS ENUM('inactive', 'active', 'past_due', 'canceled');--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "retainer_cents" integer;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "retainer_billing_day" integer;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "retainer_status" "retainer_status" DEFAULT 'inactive' NOT NULL;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "stripe_platform_customer_id" text;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "retainer_card_brand" text;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "retainer_card_last4" text;
CREATE TYPE "public"."discount_apply_mode" AS ENUM('order_total', 'per_item');--> statement-breakpoint
ALTER TABLE "discount_codes" ADD COLUMN "apply_mode" "discount_apply_mode" DEFAULT 'order_total' NOT NULL;--> statement-breakpoint
ALTER TABLE "discount_codes" ADD COLUMN "valid_days_of_week" jsonb DEFAULT '[]'::jsonb NOT NULL;
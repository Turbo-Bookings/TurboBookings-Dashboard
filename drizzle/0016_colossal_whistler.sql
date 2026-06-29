CREATE TYPE "public"."payment_gateway" AS ENUM('stripe', 'cash', 'groupon_ota', 'walk_in', 'other');--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "stripe_payment_intent_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "subtotal_cents_override" integer;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "payment_gateway" "payment_gateway" DEFAULT 'stripe' NOT NULL;
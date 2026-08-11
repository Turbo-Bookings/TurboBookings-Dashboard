CREATE TYPE "public"."email_suppression_reason" AS ENUM('unsubscribe', 'bounce', 'complaint');--> statement-breakpoint
CREATE TYPE "public"."email_template_type" AS ENUM('confirmation', 'reminder_24h', 'reminder_2h', 'abandoned_cart_1', 'abandoned_cart_2', 'post_tour_review', 'cancellation', 'reschedule');--> statement-breakpoint
CREATE TYPE "public"."scheduled_email_type" AS ENUM('reminder_24h', 'reminder_2h', 'abandoned_cart_1', 'abandoned_cart_2', 'post_tour_review', 'cancellation', 'reschedule');--> statement-breakpoint
CREATE TABLE "abandoned_carts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"email_lower" text NOT NULL,
	"first_name" text,
	"anonymous_id" uuid,
	"item_id" uuid,
	"availability_id" uuid,
	"cart_snapshot" jsonb,
	"marketing_opt_in" boolean DEFAULT false NOT NULL,
	"converted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"email_lower" text NOT NULL,
	"reason" "email_suppression_reason" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"type" "email_template_type" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"subject" text,
	"body_md" text,
	"discount_code_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"type" "scheduled_email_type" NOT NULL,
	"booking_id" uuid,
	"abandoned_cart_id" uuid,
	"recipient_email" text NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"idempotency_key" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"resend_email_id" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "abandoned_carts" ADD CONSTRAINT "abandoned_carts_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_discount_code_id_discount_codes_id_fk" FOREIGN KEY ("discount_code_id") REFERENCES "public"."discount_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_emails" ADD CONSTRAINT "scheduled_emails_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_emails" ADD CONSTRAINT "scheduled_emails_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_emails" ADD CONSTRAINT "scheduled_emails_abandoned_cart_id_abandoned_carts_id_fk" FOREIGN KEY ("abandoned_cart_id") REFERENCES "public"."abandoned_carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "abandoned_carts_visitor_slot_idx" ON "abandoned_carts" USING btree ("location_id","anonymous_id","availability_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_suppressions_location_email_idx" ON "email_suppressions" USING btree ("location_id","email_lower");--> statement-breakpoint
CREATE UNIQUE INDEX "email_templates_location_type_idx" ON "email_templates" USING btree ("location_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_emails_key_idx" ON "scheduled_emails" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "scheduled_emails_due_idx" ON "scheduled_emails" USING btree ("scheduled_at") WHERE "scheduled_emails"."sent_at" IS NULL AND "scheduled_emails"."canceled_at" IS NULL;
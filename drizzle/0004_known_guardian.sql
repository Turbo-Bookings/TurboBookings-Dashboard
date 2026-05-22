CREATE TYPE "public"."setup_owner" AS ENUM('operator', 'va', 'client');--> statement-breakpoint
CREATE TYPE "public"."setup_phase" AS ENUM('domain_dns', 'tracking_platforms', 'email_sms', 'fareharbor', 'site_infrastructure', 'indexing', 'cutover');--> statement-breakpoint
CREATE TYPE "public"."setup_status" AS ENUM('not_started', 'in_progress', 'submitted', 'approved', 'verified', 'failed');--> statement-breakpoint
CREATE TABLE "external_setup_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"phase" "setup_phase" NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"status" "setup_status" DEFAULT 'not_started' NOT NULL,
	"owner" "setup_owner",
	"submitted_at" timestamp,
	"expected_by" timestamp,
	"last_checked_at" timestamp,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "external_setup_items" ADD CONSTRAINT "external_setup_items_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "setup_items_location_phase_idx" ON "external_setup_items" USING btree ("location_id","phase");--> statement-breakpoint
CREATE UNIQUE INDEX "setup_items_location_kind_idx" ON "external_setup_items" USING btree ("location_id","kind");
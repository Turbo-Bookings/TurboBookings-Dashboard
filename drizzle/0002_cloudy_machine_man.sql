CREATE TYPE "public"."tracking_mode" AS ENUM('direct', 'gtm_only', 'hybrid');--> statement-breakpoint
CREATE TABLE "tracking_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"mode" "tracking_mode" DEFAULT 'direct' NOT NULL,
	"meta_pixel_id" text,
	"meta_domain_verification" text,
	"ga4_measurement_id" text,
	"gtm_container_id" text,
	"google_ads_conversion_id" text,
	"meta_capi_purchase_enabled" boolean DEFAULT false NOT NULL,
	"server_side_gtm_endpoint" text,
	"verification_results" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tracking_config_location_id_unique" UNIQUE("location_id")
);
--> statement-breakpoint
ALTER TABLE "tracking_config" ADD CONSTRAINT "tracking_config_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;
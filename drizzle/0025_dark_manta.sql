CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"email" text NOT NULL,
	"source" text DEFAULT 'popup' NOT NULL,
	"fbp" text,
	"fbc" text,
	"lead_event_id" text,
	"unsubscribed_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "popup_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"headline" text DEFAULT 'Get 10% off your ride' NOT NULL,
	"subhead" text DEFAULT 'Join our list for a one-time discount + first dibs on deals.' NOT NULL,
	"offer" text,
	"button_label" text DEFAULT 'Get my code' NOT NULL,
	"success_message" text DEFAULT 'You''re in! Check your inbox for the code.' NOT NULL,
	"incentive_code" text,
	"image_url" text,
	"delay_seconds" integer DEFAULT 8 NOT NULL,
	"exit_intent" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "popup_config_location_id_unique" UNIQUE("location_id")
);
--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "popup_config" ADD CONSTRAINT "popup_config_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "leads_location_email_idx" ON "leads" USING btree ("location_id","email");
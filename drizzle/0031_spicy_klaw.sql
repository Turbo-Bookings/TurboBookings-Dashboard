ALTER TABLE "locations" ADD COLUMN "connect_onboarding_token" text;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "connect_onboarding_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_connect_onboarding_token_unique" UNIQUE("connect_onboarding_token");
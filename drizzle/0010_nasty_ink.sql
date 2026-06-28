CREATE TYPE "public"."capacity_mode" AS ENUM('resource_based', 'fixed');--> statement-breakpoint
ALTER TABLE "availability_schedules" ALTER COLUMN "starts_at_time_local" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "availability_schedules" ALTER COLUMN "capacity_per_slot" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "availability_schedules" ADD COLUMN "start_times_local" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "capacity_mode" "capacity_mode" DEFAULT 'resource_based' NOT NULL;--> statement-breakpoint
-- Backfill: tours with no resource requirements default to fixed capacity;
-- tours that already declare resource requirements keep the resource_based default.
UPDATE "items" SET "capacity_mode" = 'fixed' WHERE "id" NOT IN (SELECT DISTINCT "item_id" FROM "resource_requirements");--> statement-breakpoint
-- Backfill: migrate any existing single start time into the new array.
UPDATE "availability_schedules" SET "start_times_local" = jsonb_build_array("starts_at_time_local") WHERE "starts_at_time_local" IS NOT NULL AND "start_times_local" = '[]'::jsonb;
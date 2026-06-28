CREATE TYPE "public"."booking_theme_mode" AS ENUM('light', 'dark');--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "booking_theme_mode" "booking_theme_mode" DEFAULT 'light' NOT NULL;
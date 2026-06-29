ALTER TABLE "booking_lines" ADD COLUMN "checked_in_units" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_lines" ADD COLUMN "no_show_units" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "booking_lines" SET "checked_in_units" = "quantity" WHERE "check_in_status" = 'checked_in';--> statement-breakpoint
UPDATE "booking_lines" SET "no_show_units" = "quantity" WHERE "check_in_status" = 'no_show';
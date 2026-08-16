ALTER TABLE "bookings" ADD COLUMN "external_ref" text;--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_location_external_ref_idx" ON "bookings" USING btree ("location_id","external_ref");
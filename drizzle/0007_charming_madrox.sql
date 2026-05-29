ALTER TABLE "contacts" RENAME TO "customers";--> statement-breakpoint
ALTER TABLE "bookings" RENAME COLUMN "contact_id" TO "customer_id";--> statement-breakpoint
ALTER TABLE "payment_methods_on_file" RENAME COLUMN "contact_id" TO "customer_id";--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_contact_id_contacts_id_fk";
--> statement-breakpoint
ALTER TABLE "customers" DROP CONSTRAINT "contacts_location_id_locations_id_fk";
--> statement-breakpoint
ALTER TABLE "payment_methods_on_file" DROP CONSTRAINT "payment_methods_on_file_contact_id_contacts_id_fk";
--> statement-breakpoint
DROP INDEX "bookings_contact_idx";--> statement-breakpoint
DROP INDEX "contacts_location_email_idx";--> statement-breakpoint
DROP INDEX "contacts_location_phone_idx";--> statement-breakpoint
DROP INDEX "pmof_contact_idx";--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "anonymous_id" uuid;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "first_attribution_click_id" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "first_attribution_click_type" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "first_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods_on_file" ADD CONSTRAINT "payment_methods_on_file_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_customer_idx" ON "bookings" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_location_email_idx" ON "customers" USING btree ("location_id","email_lower");--> statement-breakpoint
CREATE INDEX "customers_location_phone_idx" ON "customers" USING btree ("location_id","phone_e164");--> statement-breakpoint
CREATE INDEX "customers_anonymous_id_idx" ON "customers" USING btree ("anonymous_id");--> statement-breakpoint
CREATE INDEX "pmof_customer_idx" ON "payment_methods_on_file" USING btree ("customer_id");
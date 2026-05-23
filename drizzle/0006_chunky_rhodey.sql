CREATE TYPE "public"."booking_hold_status" AS ENUM('authorized', 'captured', 'released', 'expired');--> statement-breakpoint
CREATE TYPE "public"."booking_source" AS ENUM('online', 'direct', 'api');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('active', 'cancelled', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."charge_mode" AS ENUM('passed_to_customer', 'absorbed_by_client');--> statement-breakpoint
CREATE TYPE "public"."check_in_status" AS ENUM('not_yet', 'checked_in', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."custom_field_attach_level" AS ENUM('customer_type', 'whole_booking');--> statement-breakpoint
CREATE TYPE "public"."custom_field_kind" AS ENUM('text', 'checkbox', 'dropdown', 'quantity');--> statement-breakpoint
CREATE TYPE "public"."deposit_mode" AS ENUM('full', 'flat', 'per_person', 'per_unit', 'percent');--> statement-breakpoint
CREATE TYPE "public"."discount_amount_kind" AS ENUM('fixed', 'percent');--> statement-breakpoint
CREATE TYPE "public"."online_booking_status" AS ENUM('on', 'off', 'auto');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'succeeded', 'failed', 'refunded', 'partially_refunded');--> statement-breakpoint
CREATE TABLE "availabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"capacity_override" integer,
	"online_booking_status" "online_booking_status" DEFAULT 'auto' NOT NULL,
	"schedule_id" uuid,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "availability_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"rrule_text" text NOT NULL,
	"starts_at_time_local" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"capacity_per_slot" integer NOT NULL,
	"default_online_booking_status" "online_booking_status" DEFAULT 'auto' NOT NULL,
	"materialize_days_ahead" integer DEFAULT 90 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_custom_field_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"custom_field_id" uuid NOT NULL,
	"booking_line_id" uuid,
	"value_text" text,
	"value_checked" boolean,
	"value_dropdown_selected" text,
	"value_quantity" integer,
	"applied_price_cents" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"payment_method_on_file_id" uuid NOT NULL,
	"stripe_payment_intent_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" "booking_hold_status" DEFAULT 'authorized' NOT NULL,
	"captured_amount_cents" integer,
	"captured_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "booking_holds_stripe_payment_intent_id_unique" UNIQUE("stripe_payment_intent_id")
);
--> statement-breakpoint
CREATE TABLE "booking_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"customer_type_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"check_in_status" "check_in_status" DEFAULT 'not_yet' NOT NULL,
	"checked_in_at" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_reschedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"from_availability_id" uuid NOT NULL,
	"to_availability_id" uuid NOT NULL,
	"fee_charged_cents" integer DEFAULT 0 NOT NULL,
	"performed_by_user_id" text,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"availability_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"display_number" text NOT NULL,
	"source" "booking_source" NOT NULL,
	"status" "booking_status" DEFAULT 'active' NOT NULL,
	"created_by_user_id" text,
	"subtotal_cents" integer NOT NULL,
	"tax_cents" integer DEFAULT 0 NOT NULL,
	"platform_fee_cents" integer DEFAULT 0 NOT NULL,
	"discount_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer NOT NULL,
	"deposit_paid_cents" integer DEFAULT 0 NOT NULL,
	"balance_due_cents" integer DEFAULT 0 NOT NULL,
	"refunded_cents" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cancellation_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"grace_period_minutes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cancellation_policy_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"hours_before_start" integer NOT NULL,
	"refund_pct_bps" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"email_lower" text NOT NULL,
	"phone_e164" text,
	"first_name" text,
	"last_name" text,
	"marketing_email_consent_at" timestamp with time zone,
	"marketing_sms_consent_at" timestamp with time zone,
	"returning_customer" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"kind" "custom_field_kind" NOT NULL,
	"label" text NOT NULL,
	"help_text" text,
	"required" boolean DEFAULT false NOT NULL,
	"price_per_unit_cents" integer,
	"dropdown_options" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"singular" text NOT NULL,
	"plural" text NOT NULL,
	"sku" text,
	"note" text,
	"min_age" integer,
	"ticket_color" text,
	"archived" boolean DEFAULT false NOT NULL,
	"exclude_pricing_modifiers" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discount_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"code" text NOT NULL,
	"amount_kind" "discount_amount_kind" NOT NULL,
	"amount_value" integer NOT NULL,
	"max_uses" integer,
	"used_count" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"applies_to_item_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"applies_to_customer_type_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discount_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"discount_code_id" uuid NOT NULL,
	"applied_amount_cents" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "discount_redemptions_booking_id_unique" UNIQUE("booking_id")
);
--> statement-breakpoint
CREATE TABLE "item_custom_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"custom_field_id" uuid NOT NULL,
	"attach_level" "custom_field_attach_level" NOT NULL,
	"customer_type_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_customer_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"customer_type_id" uuid NOT NULL,
	"price_cents" integer NOT NULL,
	"tax_rate_bps_override" integer,
	"visibility" text DEFAULT 'visible' NOT NULL,
	"min_quantity" integer DEFAULT 0 NOT NULL,
	"max_quantity" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description_md" text,
	"photo_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_duration_minutes" integer NOT NULL,
	"bookable_online" boolean DEFAULT true NOT NULL,
	"listing_visible" boolean DEFAULT true NOT NULL,
	"cancellation_policy_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_methods_on_file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"added_from_booking_id" uuid,
	"stripe_payment_method_id" text NOT NULL,
	"brand" text,
	"last4" text,
	"exp_month" integer,
	"exp_year" integer,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "payment_methods_on_file_stripe_payment_method_id_unique" UNIQUE("stripe_payment_method_id")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"stripe_payment_intent_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"application_fee_cents" integer DEFAULT 0 NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"captured_at" timestamp with time zone,
	"refunded_amount_cents" integer DEFAULT 0 NOT NULL,
	"payment_method_type" text,
	"last4" text,
	"failure_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payments_stripe_payment_intent_id_unique" UNIQUE("stripe_payment_intent_id")
);
--> statement-breakpoint
CREATE TABLE "resource_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"customer_type_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"quantity_consumed" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"name" text NOT NULL,
	"max_concurrent_uses" integer NOT NULL,
	"out_of_service_count" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "stripe_account_id" text;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "platform_fee_bps" integer DEFAULT 600 NOT NULL;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "platform_fee_mode" charge_mode DEFAULT 'passed_to_customer' NOT NULL;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "tax_rate_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "tax_mode" charge_mode DEFAULT 'passed_to_customer' NOT NULL;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "deposit_mode" "deposit_mode" DEFAULT 'full' NOT NULL;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "deposit_amount_cents" integer;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "deposit_percent_bps" integer;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "cancellation_policy_id" uuid;--> statement-breakpoint
ALTER TABLE "availabilities" ADD CONSTRAINT "availabilities_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_schedules" ADD CONSTRAINT "availability_schedules_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_custom_field_values" ADD CONSTRAINT "booking_custom_field_values_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_custom_field_values" ADD CONSTRAINT "booking_custom_field_values_custom_field_id_custom_fields_id_fk" FOREIGN KEY ("custom_field_id") REFERENCES "public"."custom_fields"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_custom_field_values" ADD CONSTRAINT "booking_custom_field_values_booking_line_id_booking_lines_id_fk" FOREIGN KEY ("booking_line_id") REFERENCES "public"."booking_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_holds" ADD CONSTRAINT "booking_holds_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_holds" ADD CONSTRAINT "booking_holds_payment_method_on_file_id_payment_methods_on_file_id_fk" FOREIGN KEY ("payment_method_on_file_id") REFERENCES "public"."payment_methods_on_file"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_lines" ADD CONSTRAINT "booking_lines_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_lines" ADD CONSTRAINT "booking_lines_customer_type_id_customer_types_id_fk" FOREIGN KEY ("customer_type_id") REFERENCES "public"."customer_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_reschedules" ADD CONSTRAINT "booking_reschedules_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_reschedules" ADD CONSTRAINT "booking_reschedules_from_availability_id_availabilities_id_fk" FOREIGN KEY ("from_availability_id") REFERENCES "public"."availabilities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_reschedules" ADD CONSTRAINT "booking_reschedules_to_availability_id_availabilities_id_fk" FOREIGN KEY ("to_availability_id") REFERENCES "public"."availabilities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_availability_id_availabilities_id_fk" FOREIGN KEY ("availability_id") REFERENCES "public"."availabilities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_policies" ADD CONSTRAINT "cancellation_policies_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_policy_rules" ADD CONSTRAINT "cancellation_policy_rules_policy_id_cancellation_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."cancellation_policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_types" ADD CONSTRAINT "customer_types_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_discount_code_id_discount_codes_id_fk" FOREIGN KEY ("discount_code_id") REFERENCES "public"."discount_codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_custom_fields" ADD CONSTRAINT "item_custom_fields_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_custom_fields" ADD CONSTRAINT "item_custom_fields_custom_field_id_custom_fields_id_fk" FOREIGN KEY ("custom_field_id") REFERENCES "public"."custom_fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_custom_fields" ADD CONSTRAINT "item_custom_fields_customer_type_id_customer_types_id_fk" FOREIGN KEY ("customer_type_id") REFERENCES "public"."customer_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_customer_types" ADD CONSTRAINT "item_customer_types_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_customer_types" ADD CONSTRAINT "item_customer_types_customer_type_id_customer_types_id_fk" FOREIGN KEY ("customer_type_id") REFERENCES "public"."customer_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods_on_file" ADD CONSTRAINT "payment_methods_on_file_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods_on_file" ADD CONSTRAINT "payment_methods_on_file_added_from_booking_id_bookings_id_fk" FOREIGN KEY ("added_from_booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_requirements" ADD CONSTRAINT "resource_requirements_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_requirements" ADD CONSTRAINT "resource_requirements_customer_type_id_customer_types_id_fk" FOREIGN KEY ("customer_type_id") REFERENCES "public"."customer_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_requirements" ADD CONSTRAINT "resource_requirements_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "avails_item_starts_idx" ON "availabilities" USING btree ("item_id","starts_at");--> statement-breakpoint
CREATE INDEX "avails_schedule_idx" ON "availabilities" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "bcfv_booking_field_idx" ON "booking_custom_field_values" USING btree ("booking_id","custom_field_id");--> statement-breakpoint
CREATE INDEX "holds_booking_idx" ON "booking_holds" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "booking_lines_booking_idx" ON "booking_lines" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "br_booking_idx" ON "booking_reschedules" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "bookings_location_status_idx" ON "bookings" USING btree ("location_id","status");--> statement-breakpoint
CREATE INDEX "bookings_availability_idx" ON "bookings" USING btree ("availability_id");--> statement-breakpoint
CREATE INDEX "bookings_contact_idx" ON "bookings" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_location_display_idx" ON "bookings" USING btree ("location_id","display_number");--> statement-breakpoint
CREATE INDEX "cpr_policy_hours_idx" ON "cancellation_policy_rules" USING btree ("policy_id","hours_before_start");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_location_email_idx" ON "contacts" USING btree ("location_id","email_lower");--> statement-breakpoint
CREATE INDEX "contacts_location_phone_idx" ON "contacts" USING btree ("location_id","phone_e164");--> statement-breakpoint
CREATE INDEX "custom_fields_location_sort_idx" ON "custom_fields" USING btree ("location_id","sort_order");--> statement-breakpoint
CREATE INDEX "customer_types_location_sort_idx" ON "customer_types" USING btree ("location_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "discount_codes_location_code_idx" ON "discount_codes" USING btree ("location_id","code");--> statement-breakpoint
CREATE INDEX "dr_code_idx" ON "discount_redemptions" USING btree ("discount_code_id");--> statement-breakpoint
CREATE INDEX "icf_item_field_idx" ON "item_custom_fields" USING btree ("item_id","custom_field_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ict_item_type_idx" ON "item_customer_types" USING btree ("item_id","customer_type_id");--> statement-breakpoint
CREATE INDEX "items_location_sort_idx" ON "items" USING btree ("location_id","sort_order");--> statement-breakpoint
CREATE INDEX "pmof_contact_idx" ON "payment_methods_on_file" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "payments_booking_idx" ON "payments" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rr_item_type_resource_idx" ON "resource_requirements" USING btree ("item_id","customer_type_id","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "resources_location_name_idx" ON "resources" USING btree ("location_id","name");
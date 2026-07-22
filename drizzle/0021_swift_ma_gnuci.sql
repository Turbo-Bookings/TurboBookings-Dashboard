ALTER TABLE "items" ADD COLUMN "min_age" integer;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "languages" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "group_size_label" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "faqs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "cancellation_notes_md" text;
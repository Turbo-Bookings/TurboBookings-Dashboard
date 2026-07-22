ALTER TABLE "items" ADD COLUMN "highlights" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "included" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "what_to_bring" jsonb DEFAULT '[]'::jsonb NOT NULL;
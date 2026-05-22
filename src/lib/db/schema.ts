import { jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Locations move through this lifecycle: a fresh row enters as `draft`,
// transitions to `building` when the Fork CLI is triggered, becomes
// `launched` once the per-location Vercel project is live, and can later
// be `paused` (subscription lapsed) or `archived` (location closed).
export const locationStatusEnum = pgEnum("location_status", [
  "draft",
  "building",
  "launched",
  "paused",
  "archived",
]);

// Per-tour entry in a location's FareHarbor catalog. Mirrors the structure
// used by `src/config/site.ts` on each location site so the Fork CLI can
// translate one-to-one.
export type TourCatalogItem = {
  key: string;             // stable identifier, e.g. "atv1h"
  displayName: string;     // shown to users
  fareharborItemId: string;
  price: number;           // USD
  durationMinutes: number;
  flowOverride?: string;   // optional per-item flow override
};

// The locations table is the per-location admin record. Same row backs the
// intake form (during onboarding) and the operational tabs (after launch) —
// status just changes from `draft` to `launched` as the location matures.
//
// Most fields are nullable because intake is filled in over time; only
// `slug` and `status` are required at row creation.
export const locations = pgTable("locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  status: locationStatusEnum("status").notNull().default("draft"),

  // Brand block
  brandDisplayName: text("brand_display_name"),
  brandLocationLabel: text("brand_location_label"),
  brandLegalName: text("brand_legal_name"),
  contactAddress: text("contact_address"),
  contactPhone: text("contact_phone"),
  contactPhoneE164: text("contact_phone_e164"),
  contactSupportEmail: text("contact_support_email"),

  // Domain block
  domainApex: text("domain_apex"),
  domainCanonical: text("domain_canonical"),
  domainLocales: jsonb("domain_locales").$type<string[]>().default(["en"]),
  domainDefaultLocale: text("domain_default_locale").default("en"),

  // Visual block — populated mostly from the logo color extraction flow.
  visualPrimaryColor: text("visual_primary_color"),
  visualAccentColor: text("visual_accent_color"),
  visualDisplayFont: text("visual_display_font").default("Anton"),
  visualBodyFont: text("visual_body_font").default("Inter"),
  visualLogoUrl: text("visual_logo_url"),

  // FareHarbor block
  fareharborShortname: text("fareharbor_shortname"),
  fareharborDefaultFlowId: text("fareharbor_default_flow_id"),
  fareharborTourCatalog: jsonb("fareharbor_tour_catalog")
    .$type<TourCatalogItem[]>()
    .default([]),

  // Marketing block
  marketingFromName: text("marketing_from_name"),
  marketingSendingSubdomain: text("marketing_sending_subdomain"),
  marketingReplyToEmail: text("marketing_reply_to_email"),
  marketingAiChatKb: text("marketing_ai_chat_kb"),

  // Socials block
  socialsInstagram: text("socials_instagram"),
  socialsTiktok: text("socials_tiktok"),
  socialsFacebook: text("socials_facebook"),

  // Links between admin and the location's Vercel + GitHub + Edge Config.
  // Populated by the Fork CLI after it provisions the location's resources.
  vercelProjectId: text("vercel_project_id"),
  vercelEdgeConfigId: text("vercel_edge_config_id"),
  githubRepoUrl: text("github_repo_url"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Location = typeof locations.$inferSelect;
export type NewLocation = typeof locations.$inferInsert;

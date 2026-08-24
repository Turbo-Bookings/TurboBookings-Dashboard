import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

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

// Generic charge-mode enum used by both platform fee and tax. Either the
// customer pays the fee/tax line-itemed at checkout, or the client absorbs
// it from their payout via application_fee_amount / price baked in.
export const chargeModeEnum = pgEnum("charge_mode", [
  "passed_to_customer",
  "absorbed_by_client",
]);

// Monthly platform-retainer subscription state (Stripe). `inactive` = never
// started; `past_due` = a retainer invoice failed (dunning).
export const retainerStatusEnum = pgEnum("retainer_status", [
  "inactive",
  "active",
  "past_due",
  "canceled",
]);

// Reservation deposit calculation mode. No `none` — a non-zero online
// transaction is required so the platform fee can be collected. Operator
// configures per location; per-item override is V1.5.
export const depositModeEnum = pgEnum("deposit_mode", [
  "full",
  "flat",
  "per_person",
  "per_unit",
  "percent",
]);

// Light/dark theme the customer-facing booking flow renders in for this
// location. Operator-set; defaults to light.
export const bookingThemeModeEnum = pgEnum("booking_theme_mode", [
  "light",
  "dark",
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

  // IANA timezone for the location (e.g. "America/New_York", "America/Chicago").
  // Availability schedules store wall-clock local times (starts_at_time_local);
  // this is the zone those times are interpreted in when the booking system
  // materializes concrete UTC availability slots (Sprint D). Nullable until set
  // by the operator / seed.
  timezone: text("timezone"),

  // Visual block — populated mostly from the logo color extraction flow.
  visualPrimaryColor: text("visual_primary_color"),
  visualAccentColor: text("visual_accent_color"),
  visualDisplayFont: text("visual_display_font").default("Anton"),
  visualBodyFont: text("visual_body_font").default("Inter"),
  visualLogoUrl: text("visual_logo_url"),
  // Theme the customer-facing booking flow renders in (light default).
  bookingThemeMode: bookingThemeModeEnum("booking_theme_mode")
    .notNull()
    .default("light"),

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

  // Transactional email — operator-editable custom message appended to the
  // bottom of every booking-confirmation email (Markdown). Branding, From name,
  // and reply-to for those emails come automatically from the branding/contact
  // fields above; this is the one free-text block an operator can personalize.
  confirmationEmailMessageMd: text("confirmation_email_message_md"),

  // Socials block
  socialsInstagram: text("socials_instagram"),
  socialsTiktok: text("socials_tiktok"),
  socialsFacebook: text("socials_facebook"),

  // Links between admin and the location's Vercel + GitHub + Edge Config.
  // Populated by the Fork CLI after it provisions the location's resources.
  vercelProjectId: text("vercel_project_id"),
  vercelEdgeConfigId: text("vercel_edge_config_id"),
  githubRepoUrl: text("github_repo_url"),

  // Booking system / Stripe Connect — populated when client onboards Stripe.
  // stripeAccountId is the connected `acct_...` ID from Stripe Connect Standard.
  stripeAccountId: text("stripe_account_id"),

  // A no-login onboarding link we hand to the location owner.
  //
  // Stripe Account Links are single-use and expire in ~5 minutes, so they can't
  // be emailed. The alternative — giving the owner a dashboard login — means
  // making a non-technical business owner create a Clerk account and find their
  // way back to our domain, which is where operators get lost. Instead this
  // token backs a public route that mints a FRESH Account Link on every visit
  // and redirects straight into Stripe. One durable URL, no account required.
  //
  // This is a capability URL: whoever holds it can onboard THIS location's
  // Stripe account (i.e. attach a bank account that receives its payouts), so
  // it is long+random, rotatable, expires, and stops working once the account
  // can accept charges.
  connectOnboardingToken: text("connect_onboarding_token").unique(),
  connectOnboardingTokenExpiresAt: timestamp("connect_onboarding_token_expires_at", {
    withTimezone: true,
  }),

  // Platform fee — our cut on each booking. Defaults to 6% (600 bps).
  // Master role can override per client.
  platformFeeBps: integer("platform_fee_bps").notNull().default(600),
  platformFeeMode: chargeModeEnum("platform_fee_mode")
    .notNull()
    .default("passed_to_customer"),

  // Monthly platform retainer — a fixed management fee we charge the operator's
  // OWN business card on the PLATFORM Stripe account (separate from the 6%
  // per-booking fee above). Billed via a Stripe Subscription; the operator saves
  // the card (SetupIntent), an admin sets the amount + billing day and starts it.
  retainerCents: integer("retainer_cents"), // null = not configured
  retainerBillingDay: integer("retainer_billing_day"), // 1–28
  retainerStatus: retainerStatusEnum("retainer_status").notNull().default("inactive"),
  stripePlatformCustomerId: text("stripe_platform_customer_id"), // cus_… on the platform account
  stripeSubscriptionId: text("stripe_subscription_id"), // sub_…
  retainerCardBrand: text("retainer_card_brand"),
  retainerCardLast4: text("retainer_card_last4"),

  // Tax rate per location (FL is 700 = 7%; varies by state).
  taxRateBps: integer("tax_rate_bps").notNull().default(0),
  taxMode: chargeModeEnum("tax_mode").notNull().default("passed_to_customer"),

  // Reservation deposit — what customer pays online at booking time.
  // No `none` mode — a non-zero online transaction is required so the
  // platform fee always has a charge to attach to. Five modes:
  //   full         100% online, $0 at venue
  //   flat         fixed $ amount regardless of booking size
  //   per_person   fixed $ × number of riders
  //   per_unit     fixed $ × number of ATVs/UTVs booked
  //   percent      N% of total booking value
  depositMode: depositModeEnum("deposit_mode").notNull().default("full"),
  depositAmountCents: integer("deposit_amount_cents"),
  depositPercentBps: integer("deposit_percent_bps"),

  // A per-person charge the VENUE collects in cash, not us — park admission,
  // gate fee, wristband. Excluded from the platform fee base, untaxed by us and
  // never discounted, because we neither collect nor remit it; it exists in the
  // quote only so the customer-facing total is the truth. 0 hides the line.
  // Canonical comment in bookingsystem/src/lib/db/schema.ts.
  venueFeePerPersonCents: integer("venue_fee_per_person_cents").notNull().default(0),
  venueFeeLabel: text("venue_fee_label"),
  // Whether the platform fee is charged on the venue fee too. OFF by default,
  // because the venue fee is money the customer hands the park in cash and we
  // never touch it — billing a percentage of it is a commercial decision, not a
  // default. Turbo-only (manage_platform); operators never see the control.
  venueFeeInPlatformFeeBase: boolean("venue_fee_in_platform_fee_base")
    .notNull()
    .default(false),
  // How the venue fee appears to the customer.
  //
  //   true  — its own line in the breakdown, and inside the quoted cash due at
  //           check-in. Exact, but it inflates the visible Total: a 3-rider ATV
  //           booking jumps from $267.80 to $327.80 next to a $57.80 deposit.
  //   false — kept out of every quoted figure and explained by a `notice` field
  //           instead. The Total reflects only money that moves through us.
  //
  // In notice mode the fee is absent from `balanceDueAtVenueCents` too, so it
  // also leaves the manifest. That is correct only when the VENUE collects the
  // admission directly; if the operator's own staff take it at check-in, this
  // must stay itemized or they will under-collect.
  venueFeeItemized: boolean("venue_fee_itemized").notNull().default(true),

  // Optional FK to cancellation policy — null until policy is configured.
  // Self-referencing FK pattern: defined as nullable text(uuid) here and
  // turned into a real FK in the migration.
  cancellationPolicyId: uuid("cancellation_policy_id"),

  // Social proof — operator-configured Google rating shown on the customer
  // booking flow (tour page + checkout). Rating in tenths (49 = 4.9) to avoid
  // float issues. No live Places API dependency; a future cron can refresh
  // these from the Places API if a key is provided.
  googleRatingTenths: integer("google_rating_tenths"),
  googleReviewCount: integer("google_review_count"),
  googleReviewsUrl: text("google_reviews_url"),
  // Deep link to Google's write-a-review dialog (e.g. https://g.page/r/…/review),
  // used by the post-tour review email's CTA. Distinct from googleReviewsUrl,
  // which links the on-site badge to the profile for reading reviews.
  googleWriteReviewUrl: text("google_write_review_url"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Location = typeof locations.$inferSelect;
export type NewLocation = typeof locations.$inferInsert;

// Asset kinds. Singular kinds (hero_*, og_image) have at most one row per
// location — the action layer enforces this by deleting existing rows on
// upload. gallery_photo is the only kind that can repeat per location.
export const assetKindEnum = pgEnum("asset_kind", [
  "hero_desktop",
  "hero_mobile",
  "og_image",
  "gallery_photo",
]);

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    kind: assetKindEnum("kind").notNull(),
    blobUrl: text("blob_url").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    locationKindIdx: index("assets_location_kind_idx").on(t.locationId, t.kind),
  }),
);

export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;

// ---------------------------------------------------------------------------
// Tracking config — per-location runtime tracking IDs + feature flags. The
// system of record. A future step mirrors the Edge Config of each location's
// Vercel project so site renders hot-update without redeploy. Until Miami +
// HTown are refactored to read from Edge Config, the writes here are
// effectively admin-only.
// ---------------------------------------------------------------------------

export const trackingModeEnum = pgEnum("tracking_mode", [
  "direct",
  "gtm_only",
  "hybrid",
]);

export type VerificationResult = {
  /** "match" — found and matches stored value
   *  "mismatch" — found on the site but value differs
   *  "not_found" — site rendered but expected pattern absent
   *  "fetch_failed" — couldn't load the live URL */
  status: "match" | "mismatch" | "not_found" | "fetch_failed";
  checkedAt: string;
  foundValue?: string;
  message?: string;
};

export const trackingConfig = pgTable("tracking_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  locationId: uuid("location_id")
    .notNull()
    .references(() => locations.id, { onDelete: "cascade" })
    .unique(),
  mode: trackingModeEnum("mode").notNull().default("direct"),

  // direct-mode fields
  metaPixelId: text("meta_pixel_id"),
  metaDomainVerification: text("meta_domain_verification"),
  ga4MeasurementId: text("ga4_measurement_id"),
  gtmContainerId: text("gtm_container_id"),
  googleAdsConversionId: text("google_ads_conversion_id"),
  // The Google Ads conversion LABEL for a completed booking, e.g. the
  // "abcDEF123" in send_to: "AW-<id>/abcDEF123". Required alongside the
  // conversion id — gtag needs both to attribute a Purchase.
  //
  // Without this, migrating a location off FareHarbor silently kills its Ads
  // Purchase signal: Miami's only Purchase conversion today fires from a GTM
  // tag INSIDE the FareHarbor lightframe, which disappears with the cutover,
  // and smart bidding degrades within days of losing it.
  googleAdsPurchaseLabel: text("google_ads_purchase_label"),

  // Feature flag — defaults OFF because FareHarbor's own CAPI integration is
  // canonical for Purchase. Operators flip on only when running custom
  // server-side CAPI (e.g. before a FareHarbor migration).
  metaCapiPurchaseEnabled: boolean("meta_capi_purchase_enabled")
    .notNull()
    .default(false),

  // gtm_only / hybrid mode — optional server-side GTM endpoint
  serverSideGtmEndpoint: text("server_side_gtm_endpoint"),

  // Per-field verification results from the last live-site check
  verificationResults: jsonb("verification_results")
    .$type<Record<string, VerificationResult>>()
    .default({}),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type TrackingConfig = typeof trackingConfig.$inferSelect;
export type NewTrackingConfig = typeof trackingConfig.$inferInsert;

// ---------------------------------------------------------------------------
// Email-capture popup (Klaviyo-style) shown on the marketing site. Content is
// operator-editable in the dashboard and read by the marketing site at request
// time (via the booking app's /api/popup-config), so edits go live without a
// site redeploy. One row per location.
// ---------------------------------------------------------------------------
export const popupConfig = pgTable("popup_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  locationId: uuid("location_id")
    .notNull()
    .references(() => locations.id, { onDelete: "cascade" })
    .unique(),
  enabled: boolean("enabled").notNull().default(false),
  headline: text("headline").notNull().default("Get 10% off your ride"),
  subhead: text("subhead")
    .notNull()
    .default("Join our list for a one-time discount + first dibs on deals."),
  offer: text("offer"), // optional eyebrow, e.g. "LIMITED TIME"
  buttonLabel: text("button_label").notNull().default("Get my code"),
  successMessage: text("success_message")
    .notNull()
    .default("You're in! Check your inbox for the code."),
  // Optional discount code revealed on success (also emailed by marketing flow).
  incentiveCode: text("incentive_code"),
  imageUrl: text("image_url"),
  // Trigger timing: show after N seconds, and/or on exit intent.
  delaySeconds: integer("delay_seconds").notNull().default(8),
  exitIntent: boolean("exit_intent").notNull().default(true),
  // After a visitor dismisses (closes without subscribing), don't show again on
  // that browser for this many days. Subscribers are suppressed permanently.
  suppressDays: integer("suppress_days").notNull().default(30),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type PopupConfig = typeof popupConfig.$inferSelect;
export type NewPopupConfig = typeof popupConfig.$inferInsert;

// ---------------------------------------------------------------------------
// Captured marketing leads (email subscribers) from the popup. Deduped per
// location+email. On capture the booking app also fires a Meta CAPI `Lead`
// event with the hashed email for EMQ + retargeting. Distinct from `customers`
// (who have bookings) — a lead may never book.
// ---------------------------------------------------------------------------
export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    email: text("email").notNull(), // stored lowercased
    source: text("source").notNull().default("popup"),
    // Browser Meta signals captured at submit, for CAPI match quality.
    fbp: text("fbp"),
    fbc: text("fbc"),
    // Shared event_id with the client Pixel `Lead` fire, for dedup.
    leadEventId: text("lead_event_id"),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    locationEmailIdx: uniqueIndex("leads_location_email_idx").on(t.locationId, t.email),
  }),
);

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;

// ---------------------------------------------------------------------------
// Per-location encrypted secrets. Generic key/value so we don't need a
// migration to add a new secret kind — set whatever well-known key the
// integration expects (META_CAPI_TOKEN, FAREHARBOR_WEBHOOK_SECRET, etc.)
//
// encryptedValue is base64(iv || authTag || ciphertext), AES-256-GCM,
// key = ADMIN_ENCRYPTION_KEY env var. See lib/crypto/secrets.ts.
//
// vercelEnvSyncedAt records when the secret was last successfully pushed to
// the location's Vercel env. Null = never pushed (either because
// VERCEL_API_TOKEN isn't configured or the location has no vercelProjectId
// yet). UI shows this as a "Pushed to Vercel: ✓ / not yet" indicator.
// ---------------------------------------------------------------------------

export const locationSecrets = pgTable(
  "location_secrets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    encryptedValue: text("encrypted_value").notNull(),
    vercelEnvSyncedAt: timestamp("vercel_env_synced_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    locationKeyIdx: uniqueIndex("location_secrets_location_key_idx").on(
      t.locationId,
      t.key,
    ),
  }),
);

export type LocationSecret = typeof locationSecrets.$inferSelect;
export type NewLocationSecret = typeof locationSecrets.$inferInsert;

// ---------------------------------------------------------------------------
// External Setup Tracker — per-location checklist of wall-clock-heavy
// external dependencies (DNS, Meta domain verification, Twilio A2P, etc.).
// The longest-pole items (Twilio A2P at 1-2 weeks) live here. Status state
// machine: not_started → in_progress → submitted → approved → verified.
// `failed` is a terminal status that needs operator intervention.
// ---------------------------------------------------------------------------

export const setupPhaseEnum = pgEnum("setup_phase", [
  "domain_dns",
  "tracking_platforms",
  "email_sms",
  "fareharbor",
  "site_infrastructure",
  "indexing",
  "cutover",
]);

export const setupStatusEnum = pgEnum("setup_status", [
  "not_started",
  "in_progress",
  "submitted",
  "approved",
  "verified",
  "failed",
]);

export const setupOwnerEnum = pgEnum("setup_owner", [
  "operator",
  "va",
  "client",
]);

export const externalSetupItems = pgTable(
  "external_setup_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    phase: setupPhaseEnum("phase").notNull(),
    /** Stable string identifier within the template — e.g. "domain_registered",
     * "twilio_a2p_brand". Lets us upsert on (location_id, kind) when the
     * template grows new items. */
    kind: text("kind").notNull(),
    label: text("label").notNull(),
    /** Optional longer description shown under the label. */
    description: text("description"),
    status: setupStatusEnum("status").notNull().default("not_started"),
    owner: setupOwnerEnum("owner"),
    submittedAt: timestamp("submitted_at"),
    expectedBy: timestamp("expected_by"),
    lastCheckedAt: timestamp("last_checked_at"),
    notes: text("notes"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    locationPhaseIdx: index("setup_items_location_phase_idx").on(
      t.locationId,
      t.phase,
    ),
    locationKindIdx: uniqueIndex("setup_items_location_kind_idx").on(
      t.locationId,
      t.kind,
    ),
  }),
);

export type ExternalSetupItem = typeof externalSetupItems.$inferSelect;
export type NewExternalSetupItem = typeof externalSetupItems.$inferInsert;

// ---------------------------------------------------------------------------
// Audit log — one row per config change. Captured by action handlers via
// the recordAudit helper. Phase 1 stores summary text only; full diff +
// per-row revert is a Phase 2 polish.
// ---------------------------------------------------------------------------

// ---------- Terms acceptance ----------

// Proof that a specific person accepted a specific version of a specific
// document, at a specific moment, from a specific address.
//
// Researching how FareHarbor binds operators found that their whole position
// rests on an acceptance event recorded in their dashboard — the agreement is
// described as running from acceptance in the booking system, not from a
// signature. None of the wording a lawyer drafts is worth anything if we cannot
// show who accepted it and when, so this table is the foundation the operator
// agreement sits on rather than an afterthought to it.
//
// Deliberately NOT in `audit_log`: that table is location-scoped and NOT NULL on
// location_id, while an acceptance can be platform-wide (a Turbo admin accepting
// on behalf of the company) and must never be pruned with a location.
//
// Append-only by convention. Never UPDATE a row here — accepting a new version
// inserts a new row, so the history of what someone agreed to over time survives.
export const termsAcceptances = pgTable(
  "terms_acceptances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Clerk user_id of the human who clicked. Never null — an acceptance with
     *  no accepter is not evidence of anything. */
    userId: text("user_id").notNull(),
    /** Email captured AT acceptance. Clerk records can be deleted or the address
     *  changed; this has to still make sense years later without them. */
    userEmail: text("user_email"),
    /** Which operator the person accepted FOR. Null = accepted for the platform
     *  itself rather than a specific location. */
    locationId: uuid("location_id").references(() => locations.id, {
      onDelete: "set null",
    }),
    /** Stable document key, e.g. "operator_agreement". */
    document: text("document").notNull(),
    /** The exact version accepted, e.g. "2026-09-01". Bump it and everyone is
     *  asked again — which is the whole point of recording it. */
    version: text("version").notNull(),
    /** Snapshot of where the text lived when accepted, so the version can be
     *  produced later even if the page moves. */
    documentUrl: text("document_url"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // One row per person per document version per location. Re-accepting the
    // same version is a no-op rather than a duplicate.
    uniqueAcceptance: uniqueIndex("terms_acceptance_unique_idx").on(
      t.userId,
      t.document,
      t.version,
      t.locationId,
    ),
    userIdx: index("terms_acceptance_user_idx").on(t.userId),
  }),
);

export type TermsAcceptance = typeof termsAcceptances.$inferSelect;
export type NewTermsAcceptance = typeof termsAcceptances.$inferInsert;

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    /** Clerk user_id of the actor. Nullable for system-initiated writes
     * (template seeding, fork CLI, scheduled jobs). */
    userId: text("user_id"),
    /** Short stable identifier — e.g. "tracking.update", "secret.set",
     * "setup.status_change", "branding.save". */
    action: text("action").notNull(),
    /** Human-readable summary shown in the Activity feed. */
    summary: text("summary").notNull(),
    /** Optional structured payload (old/new values, etc.) for future diff
     * rendering + revert. */
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    locationCreatedIdx: index("audit_log_location_created_idx").on(
      t.locationId,
      t.createdAt,
    ),
  }),
);

export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;

// ===========================================================================
// BOOKING SYSTEM — schema added 2026-05-23 for Phase 0
// ---------------------------------------------------------------------------
// Tables organized in FK-dependency order. Reads:
//   cancellation_policies → cancellation_policy_rules
//   resources, customer_types, items
//   item_customer_types, resource_requirements
//   custom_fields → item_custom_fields
//   availabilities, availability_schedules
//   customers → bookings → booking_lines, *_field_values, reschedules
//   payments, payment_methods_on_file, booking_holds
//   discount_codes → discount_redemptions
// ===========================================================================

// ---------- Cancellation policies (referenced by locations.cancellation_policy_id) ----------

export const cancellationPolicies = pgTable("cancellation_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  locationId: uuid("location_id")
    .notNull()
    .references(() => locations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  // Always-cancellable window after booking creation (lets customers undo
  // a booking they just made even if the policy cutoff has technically
  // passed). FareHarbor calls this "grace period."
  gracePeriodMinutes: integer("grace_period_minutes").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type CancellationPolicy = typeof cancellationPolicies.$inferSelect;
export type NewCancellationPolicy = typeof cancellationPolicies.$inferInsert;

// One row per refund-tier rule. e.g. {hours_before: 24, refund_pct_bps: 10000}
// for "100% refund if cancelled at least 24 hours before start." Multiple
// rules per policy supports sliding scales (V1.5+); V1 typically has one rule.
export const cancellationPolicyRules = pgTable(
  "cancellation_policy_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => cancellationPolicies.id, { onDelete: "cascade" }),
    hoursBeforeStart: integer("hours_before_start").notNull(),
    refundPctBps: integer("refund_pct_bps").notNull(), // 10000 = 100%
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    policyHoursIdx: index("cpr_policy_hours_idx").on(
      t.policyId,
      t.hoursBeforeStart,
    ),
  }),
);

export type CancellationPolicyRule = typeof cancellationPolicyRules.$inferSelect;
export type NewCancellationPolicyRule = typeof cancellationPolicyRules.$inferInsert;

// ---------- Resources (capacity pools — ATVs, UTVs, etc.) ----------

export const resources = pgTable(
  "resources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Max concurrent uses across all overlapping slots. FareHarbor's
    // "Max uses" column. Subtracted by manually-marked out-of-service units.
    maxConcurrentUses: integer("max_concurrent_uses").notNull(),
    // Operator can mark units out for maintenance — reduces effective
    // capacity until back_in_service_at fires. Null = fully available.
    outOfServiceCount: integer("out_of_service_count").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    locationNameIdx: uniqueIndex("resources_location_name_idx").on(
      t.locationId,
      t.name,
    ),
  }),
);

export type Resource = typeof resources.$inferSelect;
export type NewResource = typeof resources.$inferInsert;

// ---------- Customer types (per-location pool — Single Rider ATV, Double Rider, etc.) ----------

export const customerTypes = pgTable(
  "customer_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    singular: text("singular").notNull(),
    plural: text("plural").notNull(),
    sku: text("sku"),
    note: text("note"),
    minAge: integer("min_age"),
    // How many PEOPLE one unit of this type puts on the ground. 1 for a solo
    // rider; 2 for H-Town's "Double Rider ATV", which is one machine carrying
    // two. Only per-person money uses it — the venue fee (park admission is
    // charged per head, not per machine, so a double rider owes $40 not $20).
    // Deposit math deliberately does NOT use it: H-Town's deposit is $20 per
    // ATV, and routing it through here would silently double every deposit on
    // a live location.
    personsPerUnit: integer("persons_per_unit").notNull().default(1),
    // Visual differentiator on tickets/manifest — hex color, e.g. "#c8102e"
    ticketColor: text("ticket_color"),
    archived: boolean("archived").notNull().default(false),
    // FareHarbor calls this "exclude from pricing modifiers." Excludes the
    // type from discounts, campaigns, benefits, custom-field pricing.
    excludePricingModifiers: boolean("exclude_pricing_modifiers")
      .notNull()
      .default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    locationSortIdx: index("customer_types_location_sort_idx").on(
      t.locationId,
      t.sortOrder,
    ),
  }),
);

export type CustomerType = typeof customerTypes.$inferSelect;
export type NewCustomerType = typeof customerTypes.$inferInsert;

// ---------- Items (booking-system tours, separate from the marketing tour_catalog) ----------

// How a tour's bookable capacity is determined. One source of truth per tour:
//   resource_based  capacity derived from the tour's resource pools + per-
//                   customer-type consumption (FareHarbor's model; the default).
//                   availability_schedules.capacity_per_slot is unused/null.
//   fixed           a flat number of spots per slot, set on each schedule
//                   (capacity_per_slot); resource_requirements don't cap it.
export const capacityModeEnum = pgEnum("capacity_mode", [
  "resource_based",
  "fixed",
]);

export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Markdown-formatted description shown on the booking page ("Details").
    descriptionMd: text("description_md"),
    // Per-tour structured content lists shown as checkmark bullets on the
    // booking page. Operator-authored (dashboard tour form); empty = section
    // hidden. FareHarbor's separate-lists model.
    highlights: jsonb("highlights").$type<string[]>().notNull().default([]),
    included: jsonb("included").$type<string[]>().notNull().default([]),
    whatToBring: jsonb("what_to_bring").$type<string[]>().notNull().default([]),
    // Overview key-values (FareHarbor parity): duration comes from
    // defaultDurationMinutes; these add the rest. Null/empty → row hidden.
    minAge: integer("min_age"), // "Age 3+"
    languages: jsonb("languages").$type<string[]>().notNull().default([]), // "Offered in"
    groupSizeLabel: text("group_size_label"), // freeform, e.g. "Up to 65 ATVs"
    // Per-tour FAQ (question/answer pairs) + customer-facing cancellation prose
    // (display copy — distinct from the structured cancellationPolicyId).
    faqs: jsonb("faqs").$type<{ q: string; a: string }[]>().notNull().default([]),
    cancellationNotesMd: text("cancellation_notes_md"),
    // Array of Blob URLs for the booking page hero / gallery.
    photoUrls: jsonb("photo_urls").$type<string[]>().notNull().default([]),
    defaultDurationMinutes: integer("default_duration_minutes").notNull(),
    // How bookable capacity is computed for this tour. See capacityModeEnum.
    capacityMode: capacityModeEnum("capacity_mode")
      .notNull()
      .default("resource_based"),
    // Online bookability toggle; operator can hide an item from public flow.
    bookableOnline: boolean("bookable_online").notNull().default(true),
    listingVisible: boolean("listing_visible").notNull().default(true),
    // Optional per-item override of location.cancellation_policy_id (V1.5).
    cancellationPolicyId: uuid("cancellation_policy_id"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    locationSortIdx: index("items_location_sort_idx").on(
      t.locationId,
      t.sortOrder,
    ),
  }),
);

export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;

// ---------- Item × Customer Type pricing matrix ----------

export const itemCustomerTypes = pgTable(
  "item_customer_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    customerTypeId: uuid("customer_type_id")
      .notNull()
      .references(() => customerTypes.id, { onDelete: "restrict" }),
    priceCents: integer("price_cents").notNull(),
    // Per-(item × type) tax override; falls back to locations.tax_rate_bps
    // when null. Useful for tax-exempt customer types.
    taxRateBpsOverride: integer("tax_rate_bps_override"),
    // FareHarbor calls Visible / Hidden. Hidden customer types can only be
    // added by operators (not via online booking flow). Useful for comp /
    // affiliate-only / group-rate-only.
    visibility: text("visibility", {
      enum: ["visible", "hidden"],
    })
      .notNull()
      .default("visible"),
    minQuantity: integer("min_quantity").notNull().default(0),
    maxQuantity: integer("max_quantity"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    itemTypeIdx: uniqueIndex("ict_item_type_idx").on(t.itemId, t.customerTypeId),
  }),
);

export type ItemCustomerType = typeof itemCustomerTypes.$inferSelect;
export type NewItemCustomerType = typeof itemCustomerTypes.$inferInsert;

// ---------- Resource requirements (what each item × customer_type consumes) ----------

export const resourceRequirements = pgTable(
  "resource_requirements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    customerTypeId: uuid("customer_type_id")
      .notNull()
      .references(() => customerTypes.id, { onDelete: "restrict" }),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "restrict" }),
    // How many of this resource each unit of (item, customer_type) consumes.
    // e.g. Single Rider ATV → 1 ATV; Double Rider ATV → 1 ATV; UTV with
    // 4 seats might be → 2 UTVs in a different parameterization.
    quantityConsumed: integer("quantity_consumed").notNull().default(1),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    itemTypeResourceIdx: uniqueIndex("rr_item_type_resource_idx").on(
      t.itemId,
      t.customerTypeId,
      t.resourceId,
    ),
  }),
);

export type ResourceRequirement = typeof resourceRequirements.$inferSelect;
export type NewResourceRequirement = typeof resourceRequirements.$inferInsert;

// ---------- Custom fields (per-location pool — V1 supports 4 types) ----------

// V1 starts with 4 types per locked decision. Defer Label, Waiver, Gift card,
// Date to V1.5+. Waivers handled via Smartwaiver external link in confirmation.
export const customFieldKindEnum = pgEnum("custom_field_kind", [
  "text",
  "checkbox",
  "dropdown",
  "quantity",
  // Display-only. Collects nothing, stores nothing, can never be required —
  // it exists so an operator can put a block of explanatory text in the
  // checkout flow without dressing it up as a question. H-Town's park-admission
  // "Pricing Breakdown" was a `text` field for want of this, which put a
  // paragraph of prices in the middle of "Your details" and left the customer
  // reading two different totals on the same page.
  "notice",
]);

// Where the field is attached on a booking — to a specific customer-type line
// (e.g. minimum-age acknowledgment per rider) or to the whole booking
// (e.g. "Any special requests?" or "Photographer add-on").
export const customFieldAttachLevelEnum = pgEnum("custom_field_attach_level", [
  "customer_type",
  "whole_booking",
]);

export const customFields = pgTable(
  "custom_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    kind: customFieldKindEnum("kind").notNull(),
    label: text("label").notNull(),
    helpText: text("help_text"),
    required: boolean("required").notNull().default(false),
    // For kind=quantity — price per unit (e.g. photographer add-on $25/each).
    pricePerUnitCents: integer("price_per_unit_cents"),
    // For kind=dropdown — array of options. Stored as JSONB array of
    // { value, label } pairs to allow display-different-from-stored.
    dropdownOptions: jsonb("dropdown_options")
      .$type<Array<{ value: string; label: string }>>(),
    sortOrder: integer("sort_order").notNull().default(0),
    archived: boolean("archived").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    locationSortIdx: index("custom_fields_location_sort_idx").on(
      t.locationId,
      t.sortOrder,
    ),
  }),
);

export type CustomField = typeof customFields.$inferSelect;
export type NewCustomField = typeof customFields.$inferInsert;

// Many-to-many between items and custom_fields, with attach-level + optional
// customer_type_id (when attach_level=customer_type).
export const itemCustomFields = pgTable(
  "item_custom_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    customFieldId: uuid("custom_field_id")
      .notNull()
      .references(() => customFields.id, { onDelete: "cascade" }),
    attachLevel: customFieldAttachLevelEnum("attach_level").notNull(),
    customerTypeId: uuid("customer_type_id").references(
      () => customerTypes.id,
      { onDelete: "cascade" },
    ),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    itemFieldIdx: index("icf_item_field_idx").on(t.itemId, t.customFieldId),
  }),
);

export type ItemCustomField = typeof itemCustomFields.$inferSelect;
export type NewItemCustomField = typeof itemCustomFields.$inferInsert;

// ---------- Availability + schedules ----------

// Per-slot online-booking control. FareHarbor calls this online_booking_status.
//   on   — always bookable online
//   off  — never bookable online (operator-add only)
//   auto — bookable until min-lead-time before start, then auto-closes
export const onlineBookingStatusEnum = pgEnum("online_booking_status", [
  "on",
  "off",
  "auto",
]);

// A specific date+time slot for an item. High-volume table — bulk-generated
// from availability_schedules. Indexed by (item, starts_at).
export const availabilities = pgTable(
  "availabilities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    // Per-slot capacity override; falls back to schedule.capacityPerSlot
    // when null. Lets operators tweak a single slot without touching the
    // recurrence rule.
    capacityOverride: integer("capacity_override"),
    onlineBookingStatus: onlineBookingStatusEnum("online_booking_status")
      .notNull()
      .default("auto"),
    // FK to the schedule that generated this slot. Lets bulk-edits target
    // "all availabilities from this schedule" cleanly. Nullable for
    // manually-created one-offs.
    scheduleId: uuid("schedule_id"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    itemStartsIdx: index("avails_item_starts_idx").on(t.itemId, t.startsAt),
    scheduleIdx: index("avails_schedule_idx").on(t.scheduleId),
    // Dedupe generated slots so regeneration / the nightly cron can
    // insert-missing via onConflictDoNothing. Null scheduleId (manual one-offs)
    // are treated as distinct by Postgres, so they're unaffected.
    scheduleStartsIdx: uniqueIndex("avails_schedule_starts_idx").on(
      t.scheduleId,
      t.startsAt,
    ),
  }),
);

export type Availability = typeof availabilities.$inferSelect;
export type NewAvailability = typeof availabilities.$inferInsert;

// Recurrence rule for bulk-generating availabilities. iCalendar RRULE format
// for portability. Operator edits the schedule; a background job (or
// on-save action) generates the underlying availabilities for N weeks ahead.
export const availabilitySchedules = pgTable("availability_schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  itemId: uuid("item_id")
    .notNull()
    .references(() => items.id, { onDelete: "cascade" }),
  // Recurrence only (weekdays + season DTSTART/UNTIL); time-of-day lives in
  // startTimesLocal. e.g. "DTSTART:…\nRRULE:FREQ=WEEKLY;BYDAY=TU,TH,SA;UNTIL=…"
  rruleText: text("rrule_text").notNull(),
  // One or more wall-clock start times for each recurring day, e.g.
  // ["10:00","11:00","12:00"]. Slot generation (Sprint D) produces one slot per
  // (recurrence-date × start time). Interpreted in locations.timezone.
  startTimesLocal: jsonb("start_times_local").$type<string[]>().notNull().default([]),
  durationMinutes: integer("duration_minutes").notNull(),
  // Per-slot capacity — used ONLY when the tour's capacity_mode is "fixed".
  // Null for resource_based tours (capacity comes from resource pools).
  capacityPerSlot: integer("capacity_per_slot"),
  defaultOnlineBookingStatus: onlineBookingStatusEnum(
    "default_online_booking_status",
  )
    .notNull()
    .default("auto"),
  // Materialization horizon — how many days ahead to keep availabilities
  // populated. Background job runs nightly to roll the window forward, so this
  // is effectively "always keep this many days open." Default 540 (~18 months)
  // so customers can book a year-plus ahead; bounded by season end (RRULE
  // UNTIL) + blackout dates.
  materializeDaysAhead: integer("materialize_days_ahead")
    .notNull()
    .default(540),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type AvailabilitySchedule = typeof availabilitySchedules.$inferSelect;
export type NewAvailabilitySchedule = typeof availabilitySchedules.$inferInsert;

// ---------- Blackout dates ----------
// Operator-declared closed dates (holidays, weather, private events). Slot
// generation skips any recurrence date covered by a blackout on every run, so
// blackouts persist across nightly regeneration. Stored as local "YYYY-MM-DD"
// (interpreted in locations.timezone); endDate null = single day. itemId null =
// applies to all of the location's tours.
export const blackoutDates = pgTable(
  "blackout_dates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").references(() => items.id, { onDelete: "cascade" }),
    startDate: text("start_date").notNull(),
    endDate: text("end_date"),
    reason: text("reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    locationDateIdx: index("blackout_dates_location_date_idx").on(
      t.locationId,
      t.startDate,
    ),
  }),
);

export type BlackoutDate = typeof blackoutDates.$inferSelect;
export type NewBlackoutDate = typeof blackoutDates.$inferInsert;

// ---------- Customers ----------

// Deduped by lowercased email — the unique index doubles as case-insensitive
// dedup without needing the citext extension.
export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    emailLower: text("email_lower").notNull(),
    phoneE164: text("phone_e164"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    // Cross-system identity. Set when the customer arrives from a marketing
    // site that issued the tb_aid cookie. Join key for pre-identification
    // touchpoints on Replit. See CROSS_SYSTEM_EVENT_CONTRACT.md §3.
    anonymousId: uuid("anonymous_id"),
    firstAttributionClickId: text("first_attribution_click_id"),
    firstAttributionClickType: text("first_attribution_click_type"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }),
    // Marketing consent — separate from booking. TCPA requires affirmative
    // opt-in for SMS that can't be inferred from email opt-in.
    marketingEmailConsentAt: timestamp("marketing_email_consent_at", {
      withTimezone: true,
    }),
    marketingSmsConsentAt: timestamp("marketing_sms_consent_at", {
      withTimezone: true,
    }),
    // Set automatically after the customer's second confirmed booking.
    returningCustomer: boolean("returning_customer").notNull().default(false),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    locationEmailIdx: uniqueIndex("customers_location_email_idx").on(
      t.locationId,
      t.emailLower,
    ),
    locationPhoneIdx: index("customers_location_phone_idx").on(
      t.locationId,
      t.phoneE164,
    ),
    anonymousIdIdx: index("customers_anonymous_id_idx").on(t.anonymousId),
  }),
);

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;

// ---------- Bookings (the core record) ----------

export const bookingStatusEnum = pgEnum("booking_status", [
  "active",
  "cancelled",
  "refunded", // fully refunded but record kept for audit
]);

export const bookingSourceEnum = pgEnum("booking_source", [
  "online",   // customer self-served via the booking flow
  "direct",   // operator created on behalf of customer (phone, walk-up)
  "api",      // third-party API call
]);

export const checkInStatusEnum = pgEnum("check_in_status", [
  "not_yet",
  "checked_in",
  "no_show",
]);

// Per locked decision: single mutable booking + reschedule history. Same
// booking ID throughout the customer relationship. availability_id updates
// on reschedule; booking_reschedules captures the from/to history.
export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "restrict" }),
    availabilityId: uuid("availability_id")
      .notNull()
      .references(() => availabilities.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),

    // Human-readable sequential number, per location. Assigned by a per-
    // location sequence (migration adds a Postgres sequence + default).
    displayNumber: text("display_number").notNull(),

    source: bookingSourceEnum("source").notNull(),
    status: bookingStatusEnum("status").notNull().default("active"),

    createdByUserId: text("created_by_user_id"), // Clerk user_id, null for online

    // Identifier from the system this booking was migrated FROM, prefixed by
    // source (e.g. "fh:AB12CD" for FareHarbor). Null for bookings we created.
    // Unique per location so re-running an import is a no-op rather than a
    // double-insert — this is the importer's only idempotency key.
    externalRef: text("external_ref"),

    // Stamped when an operator push alert has been sent for this booking, so a
    // retry or an overlapping cron tick can never notify twice. Nullable, and
    // the send query is ALSO bounded to bookings created in the last few
    // minutes — that bound is what stops the very first run from firing an alert
    // for all 198 pre-existing bookings at once.
    alertedAt: timestamp("alerted_at", { withTimezone: true }),

    // Pricing snapshot at booking time. Doesn't update if item prices change.
    subtotalCents: integer("subtotal_cents").notNull(),
    // Operator-entered subtotal override (custom rate); null = computed from
    // line prices. When set, it became the base subtotal for this booking.
    subtotalCentsOverride: integer("subtotal_cents_override"),
    taxCents: integer("tax_cents").notNull().default(0),
    platformFeeCents: integer("platform_fee_cents").notNull().default(0),
  // Fee we were owed but could NOT take. Kept separate so platform_fee_cents stays a true record of
  // money received and revenue reports don't overstate.
  //
  // It fills when a booking's value rises after checkout — a cross-tour reschedule, an ATV added at
  // check-in — and the top-up charge cannot land: no card on file, an expired card, or a customer who
  // paid by Link / Cash App / Klarna, none of which leave a reusable card. FareHarbor-imported
  // bookings can never pay it at all, having no Stripe payment behind them.
  platformFeeUncollectedCents: integer("platform_fee_uncollected_cents").notNull().default(0),
  // Set when an operator accepts that the uncollected amount will never be recovered, so it stops
  // appearing as outstanding work.
  platformFeeWrittenOffAt: timestamp("platform_fee_written_off_at", { withTimezone: true }),
    discountCents: integer("discount_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull(),

    // Deposit math — what was charged online vs. what's still due at venue.
    depositPaidCents: integer("deposit_paid_cents").notNull().default(0),
    balanceDueCents: integer("balance_due_cents").notNull().default(0),
    refundedCents: integer("refunded_cents").notNull().default(0),

    notes: text("notes"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancellationReason: text("cancellation_reason"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    locationStatusIdx: index("bookings_location_status_idx").on(
      t.locationId,
      t.status,
    ),
    availabilityIdx: index("bookings_availability_idx").on(t.availabilityId),
    customerIdx: index("bookings_customer_idx").on(t.customerId),
    displayNumberIdx: uniqueIndex("bookings_location_display_idx").on(
      t.locationId,
      t.displayNumber,
    ),
    // NULLs are distinct in Postgres, so this constrains only imported rows —
    // every booking we created ourselves keeps external_ref NULL and is
    // unaffected.
    externalRefIdx: uniqueIndex("bookings_location_external_ref_idx").on(
      t.locationId,
      t.externalRef,
    ),
  }),
);

export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;

// One row per customer-type line within a booking.
// e.g. "3 Double Rider ATVs at $150 each" + "9 Single Rider ATVs at $130 each"
// → 2 booking_lines rows.
export const bookingLines = pgTable(
  "booking_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    customerTypeId: uuid("customer_type_id")
      .notNull()
      .references(() => customerTypes.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    // Per-vehicle check-in counts (each ≤ quantity). The rest of the units are
    // "not yet". Booking rolls up to all / partially / no-show / not-yet.
    checkedInUnits: integer("checked_in_units").notNull().default(0),
    noShowUnits: integer("no_show_units").notNull().default(0),
    // Legacy single-status column — kept for back-compat, derived from counts.
    checkInStatus: checkInStatusEnum("check_in_status")
      .notNull()
      .default("not_yet"),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    bookingIdx: index("booking_lines_booking_idx").on(t.bookingId),
  }),
);

export type BookingLine = typeof bookingLines.$inferSelect;
export type NewBookingLine = typeof bookingLines.$inferInsert;

// Custom-field responses on a booking. When attached at customer_type level,
// bookingLineId points to the line; for whole_booking attach, bookingLineId
// is null.
export const bookingCustomFieldValues = pgTable(
  "booking_custom_field_values",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    customFieldId: uuid("custom_field_id")
      .notNull()
      .references(() => customFields.id, { onDelete: "restrict" }),
    bookingLineId: uuid("booking_line_id").references(() => bookingLines.id, {
      onDelete: "cascade",
    }),
    // Type-specific value columns. Only one is populated per row based on
    // the custom field's kind.
    valueText: text("value_text"),
    valueChecked: boolean("value_checked"),
    valueDropdownSelected: text("value_dropdown_selected"),
    valueQuantity: integer("value_quantity"),
    // For Quantity fields with pricing — the price applied at booking time.
    appliedPriceCents: integer("applied_price_cents"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    bookingFieldIdx: index("bcfv_booking_field_idx").on(
      t.bookingId,
      t.customFieldId,
    ),
  }),
);

export type BookingCustomFieldValue = typeof bookingCustomFieldValues.$inferSelect;
export type NewBookingCustomFieldValue = typeof bookingCustomFieldValues.$inferInsert;

// Reschedule history — one row per move. Booking ID stays stable.
export const bookingReschedules = pgTable(
  "booking_reschedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    fromAvailabilityId: uuid("from_availability_id")
      .notNull()
      .references(() => availabilities.id, { onDelete: "restrict" }),
    toAvailabilityId: uuid("to_availability_id")
      .notNull()
      .references(() => availabilities.id, { onDelete: "restrict" }),
    feeChargedCents: integer("fee_charged_cents").notNull().default(0),
    performedByUserId: text("performed_by_user_id"), // Clerk user_id
    reason: text("reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    bookingIdx: index("br_booking_idx").on(t.bookingId),
  }),
);

export type BookingReschedule = typeof bookingReschedules.$inferSelect;
export type NewBookingReschedule = typeof bookingReschedules.$inferInsert;

// ---------- Payments + holds ----------

export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "succeeded",
  "failed",
  "refunded",
  "partially_refunded",
]);

// How the money was collected. "stripe" = an online/card charge with a real
// PaymentIntent; the rest are operator-recorded (no Stripe), e.g. a Groupon/OTA
// voucher or cash on arrival.
export const paymentGatewayEnum = pgEnum("payment_gateway", [
  "stripe",
  "cash",
  "groupon_ota",
  "walk_in",
  "other",
]);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    paymentGateway: paymentGatewayEnum("payment_gateway").notNull().default("stripe"),
    // Null for non-Stripe (cash / Groupon / walk-in) records. Unique among
    // non-null values (Postgres allows many NULLs).
    stripePaymentIntentId: text("stripe_payment_intent_id").unique(),
    // Captured = funds flowed. For manual-capture intents (security holds),
    // captured_at is set only after operator captures. See booking_holds for
    // the auth-only flow.
    amountCents: integer("amount_cents").notNull(),
    applicationFeeCents: integer("application_fee_cents")
      .notNull()
      .default(0),
    status: paymentStatusEnum("status").notNull().default("pending"),
    capturedAt: timestamp("captured_at", { withTimezone: true }),
    refundedAmountCents: integer("refunded_amount_cents")
      .notNull()
      .default(0),
    paymentMethodType: text("payment_method_type"), // card, us_bank_account, etc.
    last4: text("last4"),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    bookingIdx: index("payments_booking_idx").on(t.bookingId),
  }),
);

export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;

// Saved Payment Methods. Created when customer pays deposit (SetupIntent
// confirms the card and saves it for later use at the security hold step).
// Many-to-one with customers so a returning customer can use a previously-
// saved card.
export const paymentMethodsOnFile = pgTable(
  "payment_methods_on_file",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    // Optional — which booking's deposit saved this card. Null if added
    // ad-hoc at check-in.
    addedFromBookingId: uuid("added_from_booking_id").references(
      () => bookings.id,
      { onDelete: "set null" },
    ),
    stripePaymentMethodId: text("stripe_payment_method_id").notNull().unique(),
    brand: text("brand"), // visa, mastercard, etc.
    last4: text("last4"),
    expMonth: integer("exp_month"),
    expYear: integer("exp_year"),
    archived: boolean("archived").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => ({
    customerIdx: index("pmof_customer_idx").on(t.customerId),
  }),
);

export type PaymentMethodOnFile = typeof paymentMethodsOnFile.$inferSelect;
export type NewPaymentMethodOnFile = typeof paymentMethodsOnFile.$inferInsert;

// Security holds — manual-capture PaymentIntents. Created at check-in.
// Released by canceling the intent; captured by capturing the intent
// (e.g., if damage occurs).
export const bookingHoldStatusEnum = pgEnum("booking_hold_status", [
  "authorized",
  "captured",
  "released",
  "expired",
]);

export const bookingHolds = pgTable(
  "booking_holds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    paymentMethodOnFileId: uuid("payment_method_on_file_id")
      .notNull()
      .references(() => paymentMethodsOnFile.id, { onDelete: "restrict" }),
    stripePaymentIntentId: text("stripe_payment_intent_id").notNull().unique(),
    amountCents: integer("amount_cents").notNull(),
    status: bookingHoldStatusEnum("status").notNull().default("authorized"),
    capturedAmountCents: integer("captured_amount_cents"),
    capturedAt: timestamp("captured_at", { withTimezone: true }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    reason: text("reason"), // operator's note when capturing
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    bookingIdx: index("holds_booking_idx").on(t.bookingId),
  }),
);

export type BookingHold = typeof bookingHolds.$inferSelect;
export type NewBookingHold = typeof bookingHolds.$inferInsert;

// ---------- Discount codes ----------

export const discountAmountKindEnum = pgEnum("discount_amount_kind", [
  "fixed",   // dollar amount (cents)
  "percent", // basis points (10000 = 100%)
]);

// Whether a code discounts each qualifying line separately (per_item — a fixed
// amount comes off EVERY qualifying item × its quantity) or once off the order
// total. For percent codes the two modes are mathematically identical.
export const discountApplyModeEnum = pgEnum("discount_apply_mode", [
  "order_total",
  "per_item",
]);

export const discountCodes = pgTable(
  "discount_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    amountKind: discountAmountKindEnum("amount_kind").notNull(),
    // For fixed kind: amount in cents. For percent kind: basis points.
    amountValue: integer("amount_value").notNull(),
    maxUses: integer("max_uses"), // null = unlimited
    usedCount: integer("used_count").notNull().default(0),
    active: boolean("active").notNull().default(true),
    // Restrict to specific items / customer types. Empty arrays = applies
    // to all items / all customer types.
    appliesToItemIds: jsonb("applies_to_item_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    appliesToCustomerTypeIds: jsonb("applies_to_customer_type_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    applyMode: discountApplyModeEnum("apply_mode").notNull().default("order_total"),
    // Days of week the code is valid, by the TOUR date in the location's tz.
    // 0=Sun … 6=Sat (JS getDay convention). Empty = valid any day.
    validDaysOfWeek: jsonb("valid_days_of_week")
      .$type<number[]>()
      .notNull()
      .default([]),
    validFrom: timestamp("valid_from", { withTimezone: true }),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    locationCodeIdx: uniqueIndex("discount_codes_location_code_idx").on(
      t.locationId,
      t.code,
    ),
  }),
);

export type DiscountCode = typeof discountCodes.$inferSelect;
export type NewDiscountCode = typeof discountCodes.$inferInsert;

// One redemption per booking. Constraint enforced by unique(bookingId).
// Matches FareHarbor's "one discount per booking" rule.
export const discountRedemptions = pgTable(
  "discount_redemptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" })
      .unique(),
    discountCodeId: uuid("discount_code_id")
      .notNull()
      .references(() => discountCodes.id, { onDelete: "restrict" }),
    appliedAmountCents: integer("applied_amount_cents").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    codeIdx: index("dr_code_idx").on(t.discountCodeId),
  }),
);

export type DiscountRedemption = typeof discountRedemptions.$inferSelect;
export type NewDiscountRedemption = typeof discountRedemptions.$inferInsert;

// ===========================================================================
// CROSS-SYSTEM EVENT QUEUE — added 2026-05-28 for Vercel ↔ Replit integration
// ---------------------------------------------------------------------------
// Outbound queue for events flowing Vercel → Replit. Spec'd in
// VERCEL_PREP_FOR_REPLIT_INTEGRATION.md §4.2 + CROSS_SYSTEM_EVENT_CONTRACT.md.
// emitEvent() in src/lib/events/emit.ts writes here on any send failure;
// a Vercel cron drains the queue with exponential backoff (1min, 5min, 30min,
// 6h, then dead-letter).
// ===========================================================================

export const outboundEventQueue = pgTable(
  "outbound_event_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id").notNull(),
    envelope: jsonb("envelope").$type<Record<string, unknown>>().notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", {
      withTimezone: true,
    }).notNull(),
    lastError: text("last_error"),
    succeededAt: timestamp("succeeded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pendingIdx: index("outbound_event_queue_pending_idx")
      .on(t.nextAttemptAt)
      .where(sql`${t.succeededAt} IS NULL`),
  }),
);

export type OutboundEvent = typeof outboundEventQueue.$inferSelect;
export type NewOutboundEvent = typeof outboundEventQueue.$inferInsert;

// ---------- Seat holds (transient checkout reservations) ----------
// A short-lived reservation of N units on an availability while a customer is in
// checkout, so two shoppers can't both take the last seat during the payment
// window. NOT a booking and NOT a security-deposit hold (see booking_holds).
// The customer-funnel availability query subtracts active (non-expired) holds;
// booking commit is still the authoritative oversell guard and releases the
// customer's own hold. Expired rows are ignored (expires_at filter) and swept.
export const seatHolds = pgTable(
  "seat_holds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    availabilityId: uuid("availability_id")
      .notNull()
      .references(() => availabilities.id, { onDelete: "cascade" }),
    // Opaque per-checkout token (held client-side) identifying the shopper's
    // own hold so it can be refreshed/released and excluded from its own count.
    holdToken: uuid("hold_token").notNull(),
    quantity: integer("quantity").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // One live hold per (availability, token) — upsert target for refresh.
    slotTokenIdx: uniqueIndex("seat_holds_slot_token_idx").on(
      t.availabilityId,
      t.holdToken,
    ),
    // Fast "active holds on these slots" lookup.
    slotActiveIdx: index("seat_holds_slot_active_idx").on(
      t.availabilityId,
      t.expiresAt,
    ),
  }),
);

export type SeatHold = typeof seatHolds.$inferSelect;
export type NewSeatHold = typeof seatHolds.$inferInsert;

// ===========================================================================
// LIFECYCLE EMAIL PROGRAM — added 2026-08-11
// ---------------------------------------------------------------------------
// Reminders (24h/2h), abandoned-cart recovery (2-step), post-tour review,
// cancellation/reschedule confirmations. Sent by the bookingsystem app via
// Resend, on the shared central sending domain. The dashboard owns this
// schema; the bookingsystem repo hand-mirrors these tables.
//
// - email_templates: per-location, per-type operator-editable copy/subject +
//   on/off toggle (timings are fixed in code). Sender prefers a template row's
//   overrides over code defaults.
// - scheduled_emails: the reliable send backbone. A Vercel cron in
//   bookingsystem drains due rows (mirrors outbound_event_queue + retry cron).
// - abandoned_carts: pre-payment lead capture (email-on-blur at checkout).
// - email_suppressions: unsubscribe + bounce/complaint list (CAN-SPAM) for
//   the marketing-class emails (cart + review).
// ===========================================================================

// The full set of lifecycle email types. `confirmation` is sent immediately
// (not scheduled) but still editable; the rest are scheduled/triggered.
export const emailTemplateTypeEnum = pgEnum("email_template_type", [
  "confirmation",
  "reminder_24h",
  "reminder_2h",
  "abandoned_cart_1",
  "abandoned_cart_2",
  "post_tour_review",
  "cancellation",
  "reschedule",
]);

// Per-location, per-type operator overrides. A missing row => code defaults +
// enabled. `subject`/`body_md` null => fall back to the template's code copy.
export const emailTemplates = pgTable(
  "email_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    type: emailTemplateTypeEnum("type").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    subject: text("subject"),
    bodyMd: text("body_md"),
    // Only used by abandoned_cart_2 — the operator-configured code offered in
    // the 24h recovery email. Null => no discount block.
    discountCodeId: uuid("discount_code_id").references(
      () => discountCodes.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    locationTypeIdx: uniqueIndex("email_templates_location_type_idx").on(
      t.locationId,
      t.type,
    ),
  }),
);

export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type NewEmailTemplate = typeof emailTemplates.$inferInsert;

// Pre-payment lead capture. Written when a shopper enters a valid email on the
// checkout form (email-on-blur), before paying. Keyed for upsert by
// (location, anonymous visitor, slot). `converted_at` is set at booking commit
// and cancels the pending cart-recovery emails.
export const abandonedCarts = pgTable(
  "abandoned_carts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    emailLower: text("email_lower").notNull(),
    firstName: text("first_name"),
    // tb_aid cookie — ties the cart to a visitor across the funnel.
    anonymousId: uuid("anonymous_id"),
    itemId: uuid("item_id"),
    availabilityId: uuid("availability_id"),
    // [{ ct, q }] plus item/slot so the recovery email can rebuild the
    // checkout URL (?item=&slot=&q=).
    cartSnapshot: jsonb("cart_snapshot").$type<Record<string, unknown>>(),
    marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
    convertedAt: timestamp("converted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    upsertIdx: uniqueIndex("abandoned_carts_visitor_slot_idx").on(
      t.locationId,
      t.anonymousId,
      t.availabilityId,
    ),
  }),
);

export type AbandonedCart = typeof abandonedCarts.$inferSelect;
export type NewAbandonedCart = typeof abandonedCarts.$inferInsert;

// Scheduled/triggered types (confirmation is immediate, so not here).
export const scheduledEmailTypeEnum = pgEnum("scheduled_email_type", [
  "reminder_24h",
  "reminder_2h",
  "abandoned_cart_1",
  "abandoned_cart_2",
  "post_tour_review",
  "cancellation",
  "reschedule",
]);

// The send backbone. A cron in bookingsystem drains due rows (scheduled_at <=
// now, not sent, not canceled) with retry backoff. Cancelling = set
// canceled_at (cron skips). idempotency_key guarantees exactly-once enqueue
// and is reused as Resend's Idempotency-Key on send.
export const scheduledEmails = pgTable(
  "scheduled_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    type: scheduledEmailTypeEnum("type").notNull(),
    bookingId: uuid("booking_id").references(() => bookings.id, {
      onDelete: "cascade",
    }),
    abandonedCartId: uuid("abandoned_cart_id").references(
      () => abandonedCarts.id,
      { onDelete: "cascade" },
    ),
    // Denormalized — abandoned-cart leads aren't customers yet.
    recipientEmail: text("recipient_email").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", {
      withTimezone: true,
    }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    resendEmailId: text("resend_email_id"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    keyIdx: uniqueIndex("scheduled_emails_key_idx").on(t.idempotencyKey),
    dueIdx: index("scheduled_emails_due_idx")
      .on(t.scheduledAt)
      .where(sql`${t.sentAt} IS NULL AND ${t.canceledAt} IS NULL`),
  }),
);

export type ScheduledEmail = typeof scheduledEmails.$inferSelect;
export type NewScheduledEmail = typeof scheduledEmails.$inferInsert;

export const emailSuppressionReasonEnum = pgEnum("email_suppression_reason", [
  "unsubscribe",
  "bounce",
  "complaint",
]);

// Per-location suppression list for marketing-class emails (cart + review).
// Populated by one-click unsubscribe and by Resend bounce/complaint webhooks.
export const emailSuppressions = pgTable(
  "email_suppressions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    emailLower: text("email_lower").notNull(),
    reason: emailSuppressionReasonEnum("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    locationEmailIdx: uniqueIndex("email_suppressions_location_email_idx").on(
      t.locationId,
      t.emailLower,
    ),
  }),
);

export type EmailSuppression = typeof emailSuppressions.$inferSelect;
export type NewEmailSuppression = typeof emailSuppressions.$inferInsert;

// ---------- Web push: new-booking alerts for operators ----------
//
// One row per (browser endpoint, location). A person who manages more than one
// location gets one row per location from the same device, which is why the
// unique index is on the pair rather than on the endpoint alone — it lets the
// send query filter by location without reading Clerk for every subscriber on
// every cron tick. The role check happens once, at subscribe time.
//
// Endpoints are issued by the browser's push service (FCM, Apple, Mozilla) and
// can be revoked at any time; a 404/410 from the push service means the
// subscription is dead and the row should be deleted rather than retried.
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Clerk user_id. Not a FK — Clerk is the identity store, not Postgres. */
    userId: text("user_id").notNull(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    /** Public key + auth secret from the browser's PushSubscription. */
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    /** Helps a person recognise which device to turn off. */
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    /** Consecutive send failures; used to prune dead endpoints. */
    failureCount: integer("failure_count").notNull().default(0),
  },
  (t) => ({
    endpointLocationIdx: uniqueIndex("push_subs_endpoint_location_idx").on(
      t.endpoint,
      t.locationId,
    ),
    locationIdx: index("push_subs_location_idx").on(t.locationId),
    userIdx: index("push_subs_user_idx").on(t.userId),
  }),
);

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscription = typeof pushSubscriptions.$inferInsert;

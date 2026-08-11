"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { recordAudit } from "@/lib/audit";
import { getDb, locations, type TourCatalogItem } from "@/lib/db";
import { getLocationBySlug } from "@/lib/data/locations";
import { denyIfCannot } from "@/lib/auth/roles";

type FieldErrors = Partial<
  Record<"slug" | "city" | "apex" | "displayName" | "form", string>
>;

export type CreateLocationState =
  | { ok: true }
  | {
      ok: false;
      errors: FieldErrors;
      values: { slug: string; city: string; apex: string; displayName: string };
    };

// Lowercase letters, digits, hyphens. No leading/trailing hyphens, no double
// hyphens. Mirrors npm package-name conventions because the slug doubles as
// the GitHub repo-name suffix.
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Naive but adequate apex check — labels (lowercase, digit, hyphen), at least
// one dot, TLD ≥ 2 chars. Doesn't try to validate against the public suffix
// list; operator confirms the domain works in the External Setup Tracker.
const APEX_RE = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;

export async function createLocation(
  _prev: CreateLocationState | null,
  formData: FormData,
): Promise<CreateLocationState> {
  const slug = String(formData.get("slug") ?? "").toLowerCase().trim();
  const city = String(formData.get("city") ?? "").trim();
  const apex = String(formData.get("apex") ?? "").toLowerCase().trim();
  const displayName = String(formData.get("displayName") ?? "").trim();

  const deny = await denyIfCannot("manage_config");
  if (deny)
    return { ok: false, errors: { form: deny }, values: { slug, city, apex, displayName } };

  const errors: FieldErrors = {};
  if (!slug) errors.slug = "Required";
  else if (!SLUG_RE.test(slug))
    errors.slug = "Lowercase letters, numbers, and hyphens only — no leading/trailing or double hyphens";
  else if (slug.length > 32) errors.slug = "Keep under 32 characters";

  if (!city) errors.city = "Required";

  if (!apex) errors.apex = "Required";
  else if (!APEX_RE.test(apex)) errors.apex = "Invalid domain format";

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors, values: { slug, city, apex, displayName } };
  }

  const db = getDb();
  const existing = await db
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.slug, slug))
    .limit(1);

  if (existing.length > 0) {
    return {
      ok: false,
      errors: { slug: "A location with that slug already exists" },
      values: { slug, city, apex, displayName },
    };
  }

  await db.insert(locations).values({
    slug,
    status: "draft",
    brandLocationLabel: city,
    brandDisplayName: displayName || null,
    domainApex: apex,
    domainCanonical: `https://www.${apex}`,
  });

  revalidatePath("/");
  redirect(`/locations/${slug}`);
}

// ---------------------------------------------------------------------------
// Update branding / contact / marketing / socials fields on an existing
// location. Used by the Branding & Tours tab. Validation is intentionally
// loose — most fields are filled in over time, and clients are allowed to
// blank them out. Strict validation lives on createLocation only.
// ---------------------------------------------------------------------------

type BrandingErrors = Partial<Record<string, string>>;

export type UpdateBrandingState =
  | { ok: true; savedAt: number }
  | { ok: false; errors: BrandingErrors };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\//i;
const E164_RE = /^\+[1-9]\d{6,14}$/;

// Trim, then return null for empty strings so we don't write "" into nullable
// columns. Keeps the DB tidy (NULL vs empty string distinction matters when
// rendering — null means "unset," "" means "explicitly cleared" but we treat
// both the same).
function clean(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export async function updateLocationBranding(
  slug: string,
  _prev: UpdateBrandingState | null,
  formData: FormData,
): Promise<UpdateBrandingState> {
  const deny = await denyIfCannot("manage_config");
  if (deny) return { ok: false, errors: { form: deny } };
  const brandDisplayName = clean(formData.get("brandDisplayName"));
  const brandLocationLabel = clean(formData.get("brandLocationLabel"));
  const brandLegalName = clean(formData.get("brandLegalName"));

  const contactAddress = clean(formData.get("contactAddress"));
  const contactPhone = clean(formData.get("contactPhone"));
  const contactPhoneE164 = clean(formData.get("contactPhoneE164"));
  const contactSupportEmail = clean(formData.get("contactSupportEmail"));

  const marketingFromName = clean(formData.get("marketingFromName"));
  const marketingSendingSubdomain = clean(formData.get("marketingSendingSubdomain"));
  const marketingReplyToEmail = clean(formData.get("marketingReplyToEmail"));

  const socialsInstagram = clean(formData.get("socialsInstagram"));
  const socialsTiktok = clean(formData.get("socialsTiktok"));
  const socialsFacebook = clean(formData.get("socialsFacebook"));

  const errors: BrandingErrors = {};

  if (contactSupportEmail && !EMAIL_RE.test(contactSupportEmail))
    errors.contactSupportEmail = "Invalid email format";
  if (marketingReplyToEmail && !EMAIL_RE.test(marketingReplyToEmail))
    errors.marketingReplyToEmail = "Invalid email format";

  if (contactPhoneE164 && !E164_RE.test(contactPhoneE164))
    errors.contactPhoneE164 = "Must start with + and be 7-15 digits (e.g. +18322285929)";

  for (const [field, value] of [
    ["socialsInstagram", socialsInstagram],
    ["socialsTiktok", socialsTiktok],
    ["socialsFacebook", socialsFacebook],
  ] as const) {
    if (value && !URL_RE.test(value)) errors[field] = "Must start with http:// or https://";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const db = getDb();
  await db
    .update(locations)
    .set({
      brandDisplayName,
      brandLocationLabel,
      brandLegalName,
      contactAddress,
      contactPhone,
      contactPhoneE164,
      contactSupportEmail,
      marketingFromName,
      marketingSendingSubdomain,
      marketingReplyToEmail,
      socialsInstagram,
      socialsTiktok,
      socialsFacebook,
      updatedAt: sql`now()`,
    })
    .where(eq(locations.slug, slug));

  revalidatePath(`/locations/${slug}`);
  revalidatePath("/");
  await recordAudit({ slug, action: "branding.save", summary: "Updated branding details" });

  return { ok: true, savedAt: Date.now() };
}

// ---------- Social proof (Google reviews shown on the customer flow) ----------

type ReviewsErrors = Partial<Record<"rating" | "count" | "url" | "form", string>>;
export type ReviewsState =
  | { ok: true; savedAt: number; values: ReviewsValues }
  | { ok: false; errors: ReviewsErrors; values: ReviewsValues };
export type ReviewsValues = { rating: string; count: string; url: string };

export async function updateReviews(
  slug: string,
  _prev: ReviewsState | null,
  formData: FormData,
): Promise<ReviewsState> {
  const values: ReviewsValues = {
    rating: (formData.get("rating") as string | null)?.trim() ?? "",
    count: (formData.get("count") as string | null)?.trim() ?? "",
    url: (formData.get("url") as string | null)?.trim() ?? "",
  };
  const errors: ReviewsErrors = {};

  let ratingTenths: number | null = null;
  if (values.rating) {
    const r = Number(values.rating);
    if (!Number.isFinite(r) || r < 0 || r > 5) errors.rating = "0–5 (e.g. 4.9)";
    else ratingTenths = Math.round(r * 10);
  }
  let count: number | null = null;
  if (values.count) {
    const c = Number(values.count);
    if (!Number.isInteger(c) || c < 0) errors.count = "Whole number ≥ 0";
    else count = c;
  }
  const url = values.url || null;
  if (url && !URL_RE.test(url)) errors.url = "Must start with http:// or https://";
  // A rating without a count (or vice-versa) reads oddly on the badge.
  if ((ratingTenths == null) !== (count == null))
    errors.form = "Set both rating and review count (or clear both).";

  if (Object.keys(errors).length > 0) return { ok: false, errors, values };

  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, errors: { form: "Location not found" }, values };
  const deny = await denyIfCannot("manage_config");
  if (deny) return { ok: false, errors: { form: deny }, values };

  const db = getDb();
  await db
    .update(locations)
    .set({
      googleRatingTenths: ratingTenths,
      googleReviewCount: count,
      googleReviewsUrl: url,
      updatedAt: sql`now()`,
    })
    .where(eq(locations.slug, slug));

  revalidatePath(`/locations/${slug}`);
  await recordAudit({ slug, action: "reviews.save", summary: "Updated Google reviews badge" });

  return { ok: true, savedAt: Date.now(), values };
}

// ---------------------------------------------------------------------------
// Transactional-email notifications: the operator-editable custom message that
// appends to the bottom of every booking-confirmation email. Everything else
// about those emails (branding, From name, reply-to) is derived automatically
// from the branding/contact fields, so this is the one free-text knob.
// ---------------------------------------------------------------------------

const MAX_CONFIRMATION_MESSAGE_LEN = 2000;

export type NotificationsState =
  | { ok: true; savedAt: number; value: string }
  | { ok: false; error: string; value: string };

export async function updateNotifications(
  slug: string,
  _prev: NotificationsState | null,
  formData: FormData,
): Promise<NotificationsState> {
  const value = ((formData.get("confirmationMessage") as string | null) ?? "").trim();
  if (value.length > MAX_CONFIRMATION_MESSAGE_LEN)
    return {
      ok: false,
      error: `Keep it under ${MAX_CONFIRMATION_MESSAGE_LEN} characters.`,
      value,
    };

  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found", value };
  const deny = await denyIfCannot("manage_config");
  if (deny) return { ok: false, error: deny, value };

  const db = getDb();
  await db
    .update(locations)
    .set({ confirmationEmailMessageMd: value || null, updatedAt: sql`now()` })
    .where(eq(locations.slug, slug));

  revalidatePath(`/locations/${slug}/settings/notifications`);
  await recordAudit({
    slug,
    action: "notifications.save",
    summary: "Updated booking-confirmation email message",
  });

  return { ok: true, savedAt: Date.now(), value };
}

// ---------------------------------------------------------------------------
// Replace the entire tour catalog JSONB column. Editor sends the full array
// each save (no partial updates) — simpler than diffing add/remove/reorder
// at this scale (~3-10 tours per location).
// ---------------------------------------------------------------------------

export type UpdateTourCatalogState =
  | { ok: true }
  | { ok: false; error: string; rowErrors?: Record<number, Record<string, string>> };

// Tour stable key: starts with a letter, then letters/digits. Mirrors how
// existing tour catalogs are keyed in src/config/site.ts on the location
// repos (atv1h, glowAtv, utv4seat, etc.). Lower-cased on save.
const TOUR_KEY_RE = /^[a-z][a-z0-9]*$/;

export async function updateTourCatalog(
  slug: string,
  _prev: UpdateTourCatalogState | null,
  formData: FormData,
): Promise<UpdateTourCatalogState> {
  const deny = await denyIfCannot("manage_config");
  if (deny) return { ok: false, error: deny };
  const raw = formData.get("tourCatalog");
  if (typeof raw !== "string") return { ok: false, error: "Missing tourCatalog payload" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Invalid tour catalog payload (not JSON)" };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: "Tour catalog must be an array" };
  }

  const cleaned: TourCatalogItem[] = [];
  const rowErrors: Record<number, Record<string, string>> = {};
  const seenKeys = new Set<string>();

  parsed.forEach((rawRow, idx) => {
    const row = rawRow as Record<string, unknown>;
    const errs: Record<string, string> = {};

    const key = String(row.key ?? "").trim().toLowerCase();
    const displayName = String(row.displayName ?? "").trim();
    const fareharborItemId = String(row.fareharborItemId ?? "").trim();
    const price = Number(row.price ?? 0);
    const durationMinutes = Number(row.durationMinutes ?? 0);
    const flowOverrideRaw = String(row.flowOverride ?? "").trim();

    if (!key) errs.key = "Required";
    else if (!TOUR_KEY_RE.test(key))
      errs.key = "Lowercase letter then letters/digits (e.g. atv1h, glowAtv lowercased)";
    else if (seenKeys.has(key)) errs.key = "Duplicate key";

    if (!displayName) errs.displayName = "Required";
    if (!fareharborItemId) errs.fareharborItemId = "Required";
    else if (!/^\d+$/.test(fareharborItemId))
      errs.fareharborItemId = "Must be numeric";

    if (!Number.isFinite(price) || price < 0)
      errs.price = "Must be a non-negative number";
    if (!Number.isInteger(durationMinutes) || durationMinutes < 0)
      errs.durationMinutes = "Must be a non-negative whole number";

    if (Object.keys(errs).length > 0) {
      rowErrors[idx] = errs;
      return;
    }

    seenKeys.add(key);
    const item: TourCatalogItem = {
      key,
      displayName,
      fareharborItemId,
      price,
      durationMinutes,
    };
    if (flowOverrideRaw) item.flowOverride = flowOverrideRaw;
    cleaned.push(item);
  });

  if (Object.keys(rowErrors).length > 0) {
    return { ok: false, error: "Fix the highlighted rows", rowErrors };
  }

  const db = getDb();
  await db
    .update(locations)
    .set({ fareharborTourCatalog: cleaned, updatedAt: sql`now()` })
    .where(eq(locations.slug, slug));

  revalidatePath(`/locations/${slug}`);
  await recordAudit({
    slug,
    action: "tour_catalog.save",
    summary: `Updated tour catalog (${cleaned.length} item${cleaned.length === 1 ? "" : "s"})`,
    payload: { count: cleaned.length },
  });
  return { ok: true };
}

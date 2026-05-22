"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, locations } from "@/lib/db";

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

  return { ok: true, savedAt: Date.now() };
}

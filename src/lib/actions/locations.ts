"use server";

import { eq } from "drizzle-orm";
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

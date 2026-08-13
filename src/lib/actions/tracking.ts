"use server";
import { assertCan, denyIfCannot } from "@/lib/auth/roles";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { recordAudit } from "@/lib/audit";
import { getDb, locations, trackingConfig } from "@/lib/db";
import type {
  TrackingConfig,
  VerificationResult,
} from "@/lib/db/schema";

type FieldErrors = Partial<Record<string, string>>;

export type UpdateTrackingState =
  | { ok: true }
  | { ok: false; errors: FieldErrors };

const PIXEL_RE = /^\d{15,16}$/;
const GA4_RE = /^G-[A-Z0-9]{8,12}$/;
const GTM_RE = /^GTM-[A-Z0-9]{6,10}$/;
const ADS_RE = /^AW-\d{8,12}$/;

function clean(v: FormDataEntryValue | null): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

// Ensure a tracking_config row exists for this location, returning its id.
async function ensureTrackingConfigRow(locationId: string): Promise<string> {
  const db = getDb();
  const existing = await db
    .select({ id: trackingConfig.id })
    .from(trackingConfig)
    .where(eq(trackingConfig.locationId, locationId))
    .limit(1);
  if (existing[0]) return existing[0].id;

  const inserted = await db
    .insert(trackingConfig)
    .values({ locationId })
    .returning({ id: trackingConfig.id });
  return inserted[0].id;
}

export async function getTrackingConfigForLocation(
  locationId: string,
): Promise<TrackingConfig | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(trackingConfig)
    .where(eq(trackingConfig.locationId, locationId))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateTracking(
  slug: string,
  _prev: UpdateTrackingState | null,
  formData: FormData,
): Promise<UpdateTrackingState> {
  const deny = await denyIfCannot("manage_platform", slug);
  if (deny) return { ok: false, errors: { form: deny } };
  const mode = String(formData.get("mode") ?? "direct") as
    | "direct"
    | "gtm_only"
    | "hybrid";
  if (!["direct", "gtm_only", "hybrid"].includes(mode)) {
    return { ok: false, errors: { mode: "Invalid mode" } };
  }

  const metaPixelId = clean(formData.get("metaPixelId"));
  const metaDomainVerification = clean(formData.get("metaDomainVerification"));
  const ga4MeasurementId = clean(formData.get("ga4MeasurementId"));
  const gtmContainerId = clean(formData.get("gtmContainerId"));
  const googleAdsConversionId = clean(formData.get("googleAdsConversionId"));
  const serverSideGtmEndpoint = clean(formData.get("serverSideGtmEndpoint"));
  const metaCapiPurchaseEnabled =
    formData.get("metaCapiPurchaseEnabled") === "on";

  const errors: FieldErrors = {};
  if (metaPixelId && !PIXEL_RE.test(metaPixelId))
    errors.metaPixelId = "Meta pixel ID must be 15-16 digits";
  if (ga4MeasurementId && !GA4_RE.test(ga4MeasurementId))
    errors.ga4MeasurementId = "GA4 ID must look like G-ABCDEF1234";
  if (gtmContainerId && !GTM_RE.test(gtmContainerId))
    errors.gtmContainerId = "GTM ID must look like GTM-ABC1234";
  if (googleAdsConversionId && !ADS_RE.test(googleAdsConversionId))
    errors.googleAdsConversionId = "Google Ads ID must look like AW-12345678";

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const db = getDb();
  const locRows = await db
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.slug, slug))
    .limit(1);
  if (!locRows[0]) return { ok: false, errors: { form: "Location not found" } };

  await ensureTrackingConfigRow(locRows[0].id);

  await db
    .update(trackingConfig)
    .set({
      mode,
      metaPixelId,
      metaDomainVerification,
      ga4MeasurementId,
      gtmContainerId,
      googleAdsConversionId,
      serverSideGtmEndpoint,
      metaCapiPurchaseEnabled,
      updatedAt: sql`now()`,
    })
    .where(eq(trackingConfig.locationId, locRows[0].id));

  // TODO (Phase 1 close-out): push to per-location Vercel Edge Config via
  // Vercel API. Currently a no-op — Miami + HTown haven't been refactored
  // to read from Edge Config yet. Forks created after refactor will pick
  // this up automatically.

  revalidatePath(`/locations/${slug}/tracking`);
  await recordAudit({
    slug,
    action: "tracking.update",
    summary: `Updated tracking config (mode: ${mode})`,
    payload: { mode, metaCapiPurchaseEnabled },
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Verification: fetch the location's live home page and check that each
// configured tracking ID actually appears in the rendered HTML. Per-field
// results stored in tracking_config.verificationResults JSONB. Runs
// synchronously — adds ~1-3s to the button click. Acceptable at human
// scale.
// ---------------------------------------------------------------------------

type FieldMatcher = {
  key: keyof TrackingConfig;
  /** Build a RegExp that finds the expected value (or any value of this
   * kind, for "found something, didn't match" detection). */
  build(expected: string): { exact: RegExp; any: RegExp };
};

const MATCHERS: FieldMatcher[] = [
  {
    key: "metaPixelId",
    build: (id) => ({
      exact: new RegExp(`fbq\\(\\s*['"]init['"]\\s*,\\s*['"]${id}['"]`),
      any: /fbq\(\s*['"]init['"]\s*,\s*['"](\d{15,16})['"]/,
    }),
  },
  {
    key: "ga4MeasurementId",
    build: (id) => ({
      exact: new RegExp(`['"]${id.replace("-", "\\-")}['"]`),
      any: /['"](G-[A-Z0-9]{8,12})['"]/,
    }),
  },
  {
    key: "gtmContainerId",
    build: (id) => ({
      exact: new RegExp(id.replace("-", "\\-")),
      any: /(GTM-[A-Z0-9]{6,10})/,
    }),
  },
  {
    key: "googleAdsConversionId",
    build: (id) => ({
      exact: new RegExp(id.replace("-", "\\-")),
      any: /(AW-\d{8,12})/,
    }),
  },
];

export async function verifyTracking(slug: string): Promise<void> {
  await assertCan("manage_platform", slug);
  const db = getDb();
  const locRows = await db
    .select({ id: locations.id, canonical: locations.domainCanonical })
    .from(locations)
    .where(eq(locations.slug, slug))
    .limit(1);

  if (!locRows[0]?.canonical) return;
  const cfg = await getTrackingConfigForLocation(locRows[0].id);
  if (!cfg) return;

  let html = "";
  let fetchFailed = false;
  try {
    const res = await fetch(locRows[0].canonical, {
      headers: { "user-agent": "TurboBookings-Dashboard/1.0 verify-tracking" },
      cache: "no-store",
    });
    if (!res.ok) {
      fetchFailed = true;
    } else {
      html = await res.text();
    }
  } catch (err) {
    console.error("verify fetch failed", err);
    fetchFailed = true;
  }

  const results: Record<string, VerificationResult> = {};
  const checkedAt = new Date().toISOString();

  for (const m of MATCHERS) {
    const expected = cfg[m.key];
    if (typeof expected !== "string" || !expected) continue;
    if (fetchFailed) {
      results[m.key] = {
        status: "fetch_failed",
        checkedAt,
        message: "Could not load the live URL",
      };
      continue;
    }
    const { exact, any } = m.build(expected);
    if (exact.test(html)) {
      results[m.key] = { status: "match", checkedAt };
    } else {
      const anyMatch = html.match(any);
      results[m.key] = anyMatch
        ? {
            status: "mismatch",
            checkedAt,
            foundValue: anyMatch[1],
            message: "Found a different value on the live site",
          }
        : { status: "not_found", checkedAt, message: "Pattern not found in rendered HTML" };
    }
  }

  await db
    .update(trackingConfig)
    .set({ verificationResults: results, updatedAt: sql`now()` })
    .where(eq(trackingConfig.locationId, locRows[0].id));

  revalidatePath(`/locations/${slug}/tracking`);
}

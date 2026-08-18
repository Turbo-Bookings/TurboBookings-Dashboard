"use server";
import { denyIfCannot } from "@/lib/auth/roles";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { recordAudit } from "@/lib/audit";
import { getDb, locations, trackingConfig } from "@/lib/db";
import type { Location } from "@/lib/db/schema";

const STATUS_VALUES = [
  "draft",
  "building",
  "launched",
  "paused",
  "archived",
] as const;

export type LifecycleState =
  | { ok: true; newStatus: Location["status"] }
  | { ok: false; error: string };

/**
 * Human-readable reasons a location should not be marked `launched` yet, based
 * on whether its tracking has been verified against the LIVE site.
 *
 * Deliberately reads `verificationResults` (written by verifyTracking(), which
 * fetches the real page and greps the rendered HTML) rather than just checking
 * that IDs are filled in — a configured id proves nothing about whether the
 * deployed site actually carries it. Dallas had a pixel id in the dashboard and
 * a site that rendered no pixel at all.
 *
 * Empty array = nothing blocking.
 */
async function trackingLaunchBlockers(slug: string): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({
      canonical: locations.domainCanonical,
      pixel: trackingConfig.metaPixelId,
      ga4: trackingConfig.ga4MeasurementId,
      results: trackingConfig.verificationResults,
    })
    .from(locations)
    .leftJoin(trackingConfig, eq(trackingConfig.locationId, locations.id))
    .where(eq(locations.slug, slug))
    .limit(1);
  const row = rows[0];
  if (!row) return ["Location not found"];

  const out: string[] = [];
  if (!row.canonical) {
    out.push("No canonical domain set, so the live site can't be checked.");
  }
  if (!row.pixel && !row.ga4) {
    out.push("No Meta Pixel or GA4 ID configured on the Tracking tab.");
  }

  const results = row.results ?? {};
  if (Object.keys(results).length === 0) {
    out.push('Tracking has never been verified — run Tracking → "Verify on live site".');
    return out;
  }
  for (const [field, r] of Object.entries(results)) {
    if (r.status === "match") continue;
    const detail =
      r.status === "mismatch"
        ? `live site shows a DIFFERENT value${r.foundValue ? ` (${r.foundValue})` : ""} — likely inherited from the template`
        : r.status === "not_found"
          ? "not present in the live site's HTML"
          : "couldn't fetch the live site to check";
    out.push(`${field}: ${detail}`);
  }
  return out;
}

export async function setLocationStatus(
  slug: string,
  newStatus: Location["status"],
  /**
   * Reason for launching despite failed tracking verification. Present = the
   * operator consciously overrode the gate; it is recorded in the audit log.
   * A gate with no escape hatch gets worked around in worse ways.
   */
  overrideReason?: string,
): Promise<LifecycleState> {
  const deny = await denyIfCannot("manage_config", slug);
  if (deny) return { ok: false, error: deny };
  if (!STATUS_VALUES.includes(newStatus)) {
    return { ok: false, error: "Invalid status" };
  }

  const db = getDb();
  const before = await db
    .select({ status: locations.status })
    .from(locations)
    .where(eq(locations.slug, slug))
    .limit(1);
  if (!before[0]) return { ok: false, error: "Location not found" };

  if (before[0].status === newStatus) {
    return { ok: true, newStatus };
  }

  // LAUNCH GATE: going public is the point of no return for ad spend. Dallas
  // reached deploy-ready with zero tracking and nothing objected, so verify
  // before we let a location be marked live.
  let overrodeGate = false;
  if (newStatus === "launched") {
    const problems = await trackingLaunchBlockers(slug);
    if (problems.length > 0) {
      if (!overrideReason?.trim()) {
        return {
          ok: false,
          error:
            `Tracking isn't verified on the live site, so launching would start ` +
            `spending against a site that may not report conversions:\n\n` +
            problems.map((p) => `  • ${p}`).join("\n") +
            `\n\nRun Tracking → "Verify on live site", or launch anyway with a reason.`,
        };
      }
      overrodeGate = true;
    }
  }

  await db
    .update(locations)
    .set({ status: newStatus, updatedAt: sql`now()` })
    .where(eq(locations.slug, slug));

  await recordAudit({
    slug,
    action: "lifecycle.status_change",
    summary:
      `Status ${before[0].status} → ${newStatus}` +
      (overrodeGate ? ` (tracking gate OVERRIDDEN: ${overrideReason})` : ""),
    payload: {
      from: before[0].status,
      to: newStatus,
      ...(overrodeGate ? { trackingGateOverride: overrideReason } : {}),
    },
  });

  revalidatePath(`/locations/${slug}`);
  revalidatePath("/");
  return { ok: true, newStatus };
}

// Delete is destructive — requires the operator to type the slug verbatim.
// Cascading FK deletes wipe assets, secrets, tracking_config,
// external_setup_items, audit_log. The Vercel project + GitHub repo +
// Neon DB on the location's side are NOT touched — operator deletes those
// manually if they want a full teardown.
export async function deleteLocation(
  slug: string,
  confirmSlug: string,
): Promise<{ ok: boolean; error?: string }> {
  const deny = await denyIfCannot("manage_config", slug);
  if (deny) return { ok: false, error: deny };
  if (confirmSlug !== slug) {
    return { ok: false, error: "Confirmation slug doesn't match" };
  }

  const db = getDb();
  const row = await db
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.slug, slug))
    .limit(1);
  if (!row[0]) return { ok: false, error: "Location not found" };

  // Audit before delete (audit row gets cascade-deleted too, but the
  // attempt at least lives in logs).
  await recordAudit({
    slug,
    action: "lifecycle.delete",
    summary: `Deleted location ${slug}`,
    payload: { slug },
  });

  await db.delete(locations).where(eq(locations.id, row[0].id));

  revalidatePath("/");
  redirect("/");
}

// ---------------------------------------------------------------------------
// External resource links — pure metadata updates (Vercel project ID,
// Edge Config ID, GitHub repo URL). Filled in by the Fork CLI on creation,
// or manually for existing locations (Miami / HTown).
// ---------------------------------------------------------------------------

export type UpdateLinksState =
  | { ok: true }
  | { ok: false; error: string };

export async function updateExternalLinks(
  slug: string,
  _prev: UpdateLinksState | null,
  formData: FormData,
): Promise<UpdateLinksState> {
  const deny = await denyIfCannot("manage_config", slug);
  if (deny) return { ok: false, error: deny };
  const vercelProjectId =
    String(formData.get("vercelProjectId") ?? "").trim() || null;
  const vercelEdgeConfigId =
    String(formData.get("vercelEdgeConfigId") ?? "").trim() || null;
  const githubRepoUrl =
    String(formData.get("githubRepoUrl") ?? "").trim() || null;

  if (githubRepoUrl && !/^https?:\/\//.test(githubRepoUrl)) {
    return { ok: false, error: "GitHub URL must start with http(s)://" };
  }

  const db = getDb();
  await db
    .update(locations)
    .set({
      vercelProjectId,
      vercelEdgeConfigId,
      githubRepoUrl,
      updatedAt: sql`now()`,
    })
    .where(eq(locations.slug, slug));

  await recordAudit({
    slug,
    action: "settings.external_links",
    summary: "Updated external resource links",
  });

  revalidatePath(`/locations/${slug}/settings`);
  return { ok: true };
}

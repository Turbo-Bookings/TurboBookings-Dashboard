"use server";
import { denyIfCannot } from "@/lib/auth/roles";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { recordAudit } from "@/lib/audit";
import { getDb, locations } from "@/lib/db";
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

export async function setLocationStatus(
  slug: string,
  newStatus: Location["status"],
): Promise<LifecycleState> {
  const deny = await denyIfCannot("manage_config");
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

  await db
    .update(locations)
    .set({ status: newStatus, updatedAt: sql`now()` })
    .where(eq(locations.slug, slug));

  await recordAudit({
    slug,
    action: "lifecycle.status_change",
    summary: `Status ${before[0].status} → ${newStatus}`,
    payload: { from: before[0].status, to: newStatus },
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
  const deny = await denyIfCannot("manage_config");
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
  const deny = await denyIfCannot("manage_config");
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

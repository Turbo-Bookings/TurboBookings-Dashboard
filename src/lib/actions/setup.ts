"use server";
import { assertCan } from "@/lib/auth/roles";

import { asc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { recordAudit } from "@/lib/audit";
import { externalSetupItems, getDb, locations } from "@/lib/db";
import type { ExternalSetupItem } from "@/lib/db/schema";
import { SETUP_TEMPLATE } from "@/lib/external-setup/template";

// Seed the template checklist for a location. Idempotent — re-running adds
// items present in the template but missing for this location (so the
// template can grow new rows over time without churn).
export async function initializeSetupItems(slug: string): Promise<{ added: number }> {
  await assertCan("manage_config");
  const db = getDb();
  const locRows = await db
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.slug, slug))
    .limit(1);
  if (!locRows[0]) return { added: 0 };

  const existing = await db
    .select({ kind: externalSetupItems.kind })
    .from(externalSetupItems)
    .where(eq(externalSetupItems.locationId, locRows[0].id));
  const have = new Set(existing.map((r) => r.kind));

  const toInsert = SETUP_TEMPLATE.filter((t) => !have.has(t.kind)).map((t) => ({
    locationId: locRows[0].id,
    phase: t.phase,
    kind: t.kind,
    label: t.label,
    description: t.description,
    sortOrder: t.sortOrder,
  }));

  if (toInsert.length > 0) {
    await db.insert(externalSetupItems).values(toInsert);
  }
  revalidatePath(`/locations/${slug}/setup`);
  return { added: toInsert.length };
}

export async function getSetupItemsForLocation(
  locationId: string,
): Promise<ExternalSetupItem[]> {
  const db = getDb();
  return db
    .select()
    .from(externalSetupItems)
    .where(eq(externalSetupItems.locationId, locationId))
    .orderBy(asc(externalSetupItems.sortOrder));
}

type UpdatePatch = {
  status?: ExternalSetupItem["status"];
  owner?: ExternalSetupItem["owner"] | null;
  notes?: string | null;
  expectedBy?: string | null; // ISO date
};

// Single endpoint for all per-item edits. Status changes auto-stamp
// submittedAt (when entering submitted/in_progress) and lastCheckedAt
// (on every change).
export async function updateSetupItem(
  slug: string,
  itemId: string,
  patch: UpdatePatch,
): Promise<void> {
  await assertCan("manage_config");
  const db = getDb();

  // Drizzle's .set() accepts SQL expressions for timestamp columns, so we
  // build the update object with a loose type and let the column types do
  // the validation at the call site.
  const updates: Record<string, unknown> = {
    updatedAt: sql`now()`,
    lastCheckedAt: sql`now()`,
  };

  if (patch.status !== undefined) {
    updates.status = patch.status;
    if (patch.status === "submitted" || patch.status === "in_progress") {
      updates.submittedAt = new Date();
    }
  }
  if (patch.owner !== undefined) updates.owner = patch.owner;
  if (patch.notes !== undefined) updates.notes = patch.notes;
  if (patch.expectedBy !== undefined) {
    updates.expectedBy = patch.expectedBy ? new Date(patch.expectedBy) : null;
  }

  // Read the row first so the audit summary can include the item label.
  const db2 = getDb();
  const before = await db2
    .select()
    .from(externalSetupItems)
    .where(eq(externalSetupItems.id, itemId))
    .limit(1);

  await db
    .update(externalSetupItems)
    .set(updates as Partial<ExternalSetupItem>)
    .where(eq(externalSetupItems.id, itemId));

  if (before[0]) {
    const changes: string[] = [];
    if (patch.status !== undefined && patch.status !== before[0].status) {
      changes.push(`${before[0].status} → ${patch.status}`);
    }
    if (patch.owner !== undefined && patch.owner !== before[0].owner) {
      changes.push(`owner: ${patch.owner ?? "—"}`);
    }
    if (changes.length > 0) {
      await recordAudit({
        slug,
        action: "setup.update",
        summary: `${before[0].label} (${changes.join(", ")})`,
        payload: { itemId, ...patch },
      });
    }
  }

  revalidatePath(`/locations/${slug}/setup`);
}

"use server";
import { denyIfCannot } from "@/lib/auth/roles";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { recordAudit } from "@/lib/audit";
import { materializeLocationActiveSchedules } from "@/lib/availability/generate";
import { blackoutDates, getDb, items } from "@/lib/db";
import { getLocationBySlug } from "@/lib/data/locations";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function addBlackout(
  slug: string,
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const deny = await denyIfCannot("manage_config");
  if (deny) return { ok: false, error: deny };
  const startDate = String(formData.get("startDate") ?? "").trim();
  const endRaw = String(formData.get("endDate") ?? "").trim();
  const endDate = endRaw || null;
  const itemRaw = String(formData.get("itemId") ?? "").trim();
  const itemId = itemRaw || null;
  const reason = String(formData.get("reason") ?? "").trim() || null;

  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };

  if (!DATE_RE.test(startDate)) return { ok: false, error: "Pick a valid date" };
  if (endDate && (!DATE_RE.test(endDate) || endDate < startDate))
    return { ok: false, error: "End must be on or after the start" };

  const db = getDb();
  if (itemId) {
    const ok = await db
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.locationId, location.id)))
      .limit(1);
    if (!ok[0]) return { ok: false, error: "Tour not found" };
  }

  await db
    .insert(blackoutDates)
    .values({ locationId: location.id, itemId, startDate, endDate, reason });

  // Clear any existing (unbooked) slots on the blacked-out days.
  await materializeLocationActiveSchedules(location.id, new Date());

  await recordAudit({
    slug,
    action: "catalog.blackout.create",
    summary: `Blackout ${startDate}${endDate ? `–${endDate}` : ""}`,
    payload: { startDate, endDate, itemId },
  });

  revalidatePath(`/locations/${slug}/catalog/schedule/calendar`);
  return { ok: true };
}

export async function removeBlackout(
  slug: string,
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const deny = await denyIfCannot("manage_config");
  if (deny) return { ok: false, error: deny };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };

  const db = getDb();
  const del = await db
    .delete(blackoutDates)
    .where(and(eq(blackoutDates.id, id), eq(blackoutDates.locationId, location.id)))
    .returning({ id: blackoutDates.id });
  if (del.length === 0) return { ok: false, error: "Blackout not found" };

  // Restore slots for the no-longer-blacked-out days.
  await materializeLocationActiveSchedules(location.id, new Date());

  await recordAudit({
    slug,
    action: "catalog.blackout.delete",
    summary: "Removed a blackout",
    payload: { id },
  });

  revalidatePath(`/locations/${slug}/catalog/schedule/calendar`);
  return { ok: true };
}

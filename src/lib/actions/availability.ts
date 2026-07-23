"use server";
import { denyIfCannot } from "@/lib/auth/roles";

import { eq, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { recordAudit } from "@/lib/audit";
import { availabilities, bookingReschedules, bookings, getDb } from "@/lib/db";
import { getLocationBySlug } from "@/lib/data/locations";
import { getSlot } from "@/lib/data/availability";
import { withTxn } from "@/lib/db/txn";

const VALID_STATUS = ["on", "off", "auto"] as const;

function revalidateCalendar(slug: string) {
  revalidatePath(`/locations/${slug}/catalog/schedule/calendar`);
}

export async function setSlotStatus(
  slug: string,
  slotId: string,
  status: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!VALID_STATUS.includes(status as never))
    return { ok: false, error: "Invalid status" };

  const deny = await denyIfCannot("manage_config");
  if (deny) return { ok: false, error: deny };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };
  const slot = await getSlot(slotId, location.id);
  if (!slot) return { ok: false, error: "Slot not found" };

  const db = getDb();
  await db
    .update(availabilities)
    .set({
      onlineBookingStatus: status as (typeof VALID_STATUS)[number],
      updatedAt: new Date(),
    })
    .where(eq(availabilities.id, slotId));

  await recordAudit({
    slug,
    action: "catalog.slot.status",
    summary: `Set a slot's online status to ${status}`,
    payload: { slotId, status },
  });
  revalidateCalendar(slug);
  return { ok: true };
}

export async function setSlotCapacity(
  slug: string,
  slotId: string,
  capacityRaw: string,
): Promise<{ ok: boolean; error?: string }> {
  const deny = await denyIfCannot("manage_config");
  if (deny) return { ok: false, error: deny };
  const trimmed = capacityRaw.trim();
  let capacityOverride: number | null;
  if (trimmed === "") {
    capacityOverride = null; // clear → falls back to the schedule/derived default
  } else {
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < 1 || n > 100_000)
      return { ok: false, error: "Whole number, at least 1 (or blank to clear)" };
    capacityOverride = n;
  }

  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };
  const slot = await getSlot(slotId, location.id);
  if (!slot) return { ok: false, error: "Slot not found" };

  const db = getDb();
  await db
    .update(availabilities)
    .set({ capacityOverride, updatedAt: new Date() })
    .where(eq(availabilities.id, slotId));

  await recordAudit({
    slug,
    action: "catalog.slot.capacity",
    summary: `Set a slot capacity override to ${capacityOverride ?? "default"}`,
    payload: { slotId, capacityOverride },
  });
  revalidateCalendar(slug);
  return { ok: true };
}

export async function deleteSlot(
  slug: string,
  slotId: string,
): Promise<{ ok: boolean; error?: string }> {
  const deny = await denyIfCannot("manage_config");
  if (deny) return { ok: false, error: deny };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };
  const slot = await getSlot(slotId, location.id);
  if (!slot) return { ok: false, error: "Slot not found" };

  const db = getDb();
  const booked = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(eq(bookings.availabilityId, slotId))
    .limit(1);
  if (booked[0])
    return { ok: false, error: "This slot has a booking and can't be deleted." };

  // booking_reschedules.from/to_availability_id are ON DELETE RESTRICT, so a slot
  // that was ever a reschedule source/target (e.g. the origin of a group move)
  // can't be deleted until its history rows are cleared. The slot is going away,
  // so those pointers are moot — drop them, then delete the slot atomically.
  await withTxn(async (tx) => {
    await tx
      .delete(bookingReschedules)
      .where(
        or(
          eq(bookingReschedules.fromAvailabilityId, slotId),
          eq(bookingReschedules.toAvailabilityId, slotId),
        ),
      );
    await tx.delete(availabilities).where(eq(availabilities.id, slotId));
  });

  await recordAudit({
    slug,
    action: "catalog.slot.delete",
    summary: "Deleted a slot",
    payload: { slotId },
  });
  revalidateCalendar(slug);
  return { ok: true };
}

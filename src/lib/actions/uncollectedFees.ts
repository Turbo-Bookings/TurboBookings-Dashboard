"use server";

import { revalidatePath } from "next/cache";
import { getLocationBySlug } from "@/lib/data/locations";
import { denyIfCannot } from "@/lib/auth/roles";
import {
  listUncollectedFees,
  retryUncollectedFee,
  writeOffUncollectedFee,
  type UncollectedFee,
} from "@/lib/booking/platformFee";

/**
 * Platform fee we were owed and could not take.
 *
 * Gated on `manage_platform` (admin+) throughout — this is Turbo Bookings' own revenue, not the
 * operator's, so a location's own staff have no business seeing or clearing it.
 */

export async function getUncollectedFees(slug: string): Promise<UncollectedFee[]> {
  if (await denyIfCannot("manage_platform", slug)) return [];
  return listUncollectedFees(slug);
}

export async function retryFeeCharge(
  slug: string,
  bookingId: string,
): Promise<{ ok: boolean; error?: string }> {
  const deny = await denyIfCannot("manage_platform", slug);
  if (deny) return { ok: false, error: deny };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };

  const r = await retryUncollectedFee(location, bookingId);
  revalidatePath(`/locations/${slug}/reports/uncollected-fees`);
  if (!r.charged) {
    return { ok: false, error: r.uncollectedReason ?? "The charge did not go through." };
  }
  return { ok: true };
}

export async function writeOffFee(
  slug: string,
  bookingId: string,
  note: string,
): Promise<{ ok: boolean; error?: string }> {
  const deny = await denyIfCannot("manage_platform", slug);
  if (deny) return { ok: false, error: deny };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };

  const r = await writeOffUncollectedFee(location, bookingId, note);
  revalidatePath(`/locations/${slug}/reports/uncollected-fees`);
  return r;
}

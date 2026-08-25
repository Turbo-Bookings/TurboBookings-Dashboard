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
import { billFeeToOperator } from "@/lib/billing/operatorRecovery";

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

/**
 * Recover the fee from the operator instead of the customer.
 *
 * Used once the tour has run: our fee was inside the balance the customer paid at the venue, so the
 * operator is holding it. This adds it to their next platform invoice rather than asking them to
 * remit it by hand — the manual version does not survive 3-5 more operator clients.
 */
export async function billFeeToOperatorAction(
  slug: string,
  bookingId: string,
  note: string,
): Promise<{ ok: boolean; error?: string }> {
  const deny = await denyIfCannot("manage_platform", slug);
  if (deny) return { ok: false, error: deny };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };

  const r = await billFeeToOperator(location, bookingId, note);
  revalidatePath(`/locations/${slug}/reports/uncollected-fees`);
  return { ok: r.ok, error: r.error };
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

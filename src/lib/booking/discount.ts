import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { discountCodes, getDb } from "@/lib/db";

export type DiscountResult =
  | { ok: true; discountCodeId: string; appliedAmountCents: number; label: string }
  | { ok: false; error: string };

// Validate a discount code for a booking and compute the discount on the given
// subtotal. Percent codes store basis points (20% → 2000); fixed codes store
// cents. Caller persists the redemption + bumps usedCount on commit.
export async function validateDiscountForBooking(
  locationId: string,
  code: string,
  itemId: string,
  customerTypeIds: string[],
  subtotalCents: number,
): Promise<DiscountResult> {
  const trimmed = code.trim();
  if (!trimmed) return { ok: false, error: "Enter a code" };
  const db = getDb();
  const rows = await db
    .select()
    .from(discountCodes)
    .where(
      and(
        eq(discountCodes.locationId, locationId),
        sql`upper(${discountCodes.code}) = ${trimmed.toUpperCase()}`,
      ),
    )
    .limit(1);
  const dc = rows[0];
  if (!dc) return { ok: false, error: "Code not found" };
  if (!dc.active) return { ok: false, error: "Code is inactive" };
  const now = new Date();
  if (dc.validFrom && now < dc.validFrom) return { ok: false, error: "Code not active yet" };
  if (dc.validUntil && now > dc.validUntil) return { ok: false, error: "Code expired" };
  if (dc.maxUses != null && dc.usedCount >= dc.maxUses)
    return { ok: false, error: "Code fully redeemed" };
  if (dc.appliesToItemIds.length > 0 && !dc.appliesToItemIds.includes(itemId))
    return { ok: false, error: "Code doesn't apply to this tour" };
  if (
    dc.appliesToCustomerTypeIds.length > 0 &&
    !customerTypeIds.some((c) => dc.appliesToCustomerTypeIds.includes(c))
  )
    return { ok: false, error: "Code doesn't apply to these rider types" };

  let amt =
    dc.amountKind === "percent"
      ? Math.round(subtotalCents * (dc.amountValue / 10000))
      : dc.amountValue;
  amt = Math.max(0, Math.min(amt, subtotalCents));
  const label =
    dc.amountKind === "percent"
      ? `${(dc.amountValue / 100).toFixed(0)}% off`
      : `$${(dc.amountValue / 100).toFixed(2)} off`;
  return { ok: true, discountCodeId: dc.id, appliedAmountCents: amt, label };
}

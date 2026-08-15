import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { discountCodes, getDb } from "@/lib/db";

export type DiscountResult =
  | { ok: true; discountCodeId: string; appliedAmountCents: number; label: string }
  | { ok: false; error: string };

// One order line, needed for per-item fixed discounts.
export type DiscountLine = {
  customerTypeId: string;
  quantity: number;
  unitPriceCents: number;
};

// 0=Sun … 6=Sat (JS getDay convention) for a date, evaluated in an IANA tz.
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
function weekdayInTz(date: Date, tz: string): number {
  const s = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(date);
  return WD[s] ?? date.getDay();
}

// Validate a discount code for a booking and compute the discount on the given
// subtotal. Percent codes store basis points (20% → 2000); fixed codes store
// cents. `opts.lines` enables per-item fixed discounts; `opts.tourStartsAt` +
// `opts.timezone` enable day-of-week validity (judged by the TOUR date in the
// location tz). Caller persists the redemption + bumps usedCount on commit.
export async function validateDiscountForBooking(
  locationId: string,
  code: string,
  itemId: string,
  customerTypeIds: string[],
  subtotalCents: number,
  opts?: { lines?: DiscountLine[]; tourStartsAt?: Date; timezone?: string },
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

  // Day-of-week validity — judged by the tour date in the location tz. If the
  // caller can't supply the tour date, the day restriction is skipped.
  if (dc.validDaysOfWeek.length > 0 && opts?.tourStartsAt && opts?.timezone) {
    const dow = weekdayInTz(opts.tourStartsAt, opts.timezone);
    if (!dc.validDaysOfWeek.includes(dow))
      return { ok: false, error: "Code isn't valid for that day" };
  }

  // Compute the discount. Percent is identical per-item vs order-total. For
  // fixed per-item, the amount comes off each qualifying line × its quantity.
  let amt: number;
  if (dc.amountKind === "percent") {
    amt = Math.round(subtotalCents * (dc.amountValue / 10000));
  } else if (dc.applyMode === "per_item" && opts?.lines?.length) {
    const qualifies = (ctId: string) =>
      dc.appliesToCustomerTypeIds.length === 0 || dc.appliesToCustomerTypeIds.includes(ctId);
    const qty = opts.lines
      .filter((l) => qualifies(l.customerTypeId))
      .reduce((s, l) => s + l.quantity, 0);
    amt = dc.amountValue * qty;
  } else {
    amt = dc.amountValue;
  }
  amt = Math.max(0, Math.min(amt, subtotalCents));

  const dollars = `$${(dc.amountValue / 100).toFixed(2)} off`;
  const label =
    dc.amountKind === "percent"
      ? `${(dc.amountValue / 100).toFixed(0)}% off`
      : dc.applyMode === "per_item"
        ? `${dollars} each`
        : dollars;
  return { ok: true, discountCodeId: dc.id, appliedAmountCents: amt, label };
}

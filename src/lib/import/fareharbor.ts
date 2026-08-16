// Normalizing a FareHarbor CSV export into shapes our schema understands.
//
// Deliberately free of DB access and `server-only` so the CLI, the server
// action, and the parser self-check can all share it.

import { DateTime } from "luxon";
import { normalizeHeader } from "./csv";

/** Logical fields we need, independent of whatever FareHarbor called them. */
export type FieldKey =
  | "externalRef"
  | "itemName"
  | "startDate"
  | "startTime"
  | "customerName"
  | "customerEmail"
  | "customerPhone"
  | "riderTypeName"
  | "quantity"
  | "subtotalCents"
  | "taxCents"
  | "totalCents"
  | "paidCents"
  | "dueCents"
  | "status"
  | "notes";

/**
 * Header aliases, normalized (lowercase, alphanumerics only). Used to
 * pre-select a mapping the operator then confirms — never to decide silently.
 * Order matters: earlier entries win when a header matches more than one.
 */
export const HEADER_ALIASES: Record<FieldKey, string[]> = {
  externalRef: [
    "bookingid", "bookingpk", "bookingref", "bookingreference", "confirmation",
    "confirmationnumber", "booking", "pk", "uuid", "ref",
  ],
  itemName: ["item", "itemname", "tour", "product", "activity", "availabilityitem"],
  startDate: ["date", "startdate", "availabilitydate", "availabilitystartdate", "tourdate"],
  startTime: ["time", "starttime", "availabilitystarttime", "availabilitystart"],
  customerName: ["contact", "contactname", "customer", "customername", "name", "leadcustomer"],
  customerEmail: ["contactemail", "customeremail", "email", "emailaddress"],
  customerPhone: ["contactphone", "customerphone", "phone", "phonenumber", "mobile"],
  riderTypeName: ["customertype", "customertypename", "ridertype", "tickettype"],
  quantity: ["ofpax", "pax", "quantity", "qty", "numberofcustomers", "guests", "customers"],
  subtotalCents: ["subtotal", "itemsubtotal"],
  taxCents: ["totaltax", "tax", "taxes", "salestax"],
  totalCents: ["total", "bookingtotal", "grandtotal"],
  paidCents: ["totalpaid", "amountpaid", "paid", "receivedtotal", "received"],
  dueCents: ["amountdue", "balancedue", "balance", "due"],
  status: ["cancelled", "canceled", "iscancelled", "status", "bookingstatus"],
  notes: ["notes", "note", "internalnote", "comments", "specialrequests"],
};

export type ColumnMapping = Partial<Record<FieldKey, string>>;

/**
 * Best-guess mapping from the file's actual headers. Exact normalized match
 * first, then a containment match, so "Availability: Start Time" still finds
 * `startTime`. Every guess is shown to the operator for confirmation.
 */
export function suggestMapping(headers: string[]): ColumnMapping {
  const norm = headers.map((h) => ({ raw: h, key: normalizeHeader(h) }));
  const used = new Set<string>();
  const out: ColumnMapping = {};
  const fields = Object.entries(HEADER_ALIASES) as [FieldKey, string[]][];

  // TWO PASSES, and the order matters. Exact matches claim their header first
  // across every field, because containment is greedy in a way that silently
  // steals columns: "Total Tax" contains "total", so a one-pass loop would let
  // `totalCents` swallow the tax column before `taxCents` ever looked at it —
  // and the money would be wrong with no error anywhere.
  for (const [field, aliases] of fields) {
    const hit = norm.find((h) => !used.has(h.raw) && aliases.includes(h.key));
    if (hit) {
      out[field] = hit.raw;
      used.add(hit.raw);
    }
  }
  for (const [field, aliases] of fields) {
    if (out[field]) continue;
    const hit = norm.find(
      (h) => !used.has(h.raw) && aliases.some((a) => h.key.includes(a) || a.includes(h.key)),
    );
    if (hit) {
      out[field] = hit.raw;
      used.add(hit.raw);
    }
  }
  return out;
}

/**
 * Money → integer cents. Tolerates "$1,234.56", "1234.56", "(12.00)" for
 * negatives, and a trailing "USD". Returns null when the cell isn't money at
 * all, so the caller can flag the row instead of importing a silent zero.
 */
export function parseMoneyCents(raw: string): number | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s) || s.startsWith("-");
  const digits = s.replace(/[()\-+]/g, "").replace(/usd/i, "").replace(/[$,\s]/g, "");
  if (!/^\d*\.?\d*$/.test(digits) || digits === "" || digits === ".") return null;
  const value = Number(digits);
  if (!Number.isFinite(value)) return null;
  const cents = Math.round(value * 100);
  return negative ? -cents : cents;
}

// Accepted date/time layouts, widest-first. Anything not listed falls through
// to ISO parsing before we give up.
const DATETIME_FORMATS = [
  "yyyy-LL-dd HH:mm:ss",
  "yyyy-LL-dd HH:mm",
  "yyyy-LL-dd h:mm a",
  "LL/dd/yyyy HH:mm:ss",
  "LL/dd/yyyy HH:mm",
  "LL/dd/yyyy h:mm a",
  "L/d/yyyy h:mm a",
  "L/d/yyyy HH:mm",
  "LLL d, yyyy h:mm a",
  "LLLL d, yyyy h:mm a",
  "ccc, LLL d, yyyy h:mm a",
  "yyyy-LL-dd",
  "LL/dd/yyyy",
  "L/d/yyyy",
];

/**
 * Parse a FareHarbor local date (+ optional separate time) into a UTC instant,
 * interpreting the wall-clock reading in the LOCATION's timezone — exactly how
 * expandScheduleToSlots builds slots (src/lib/availability/generate.ts:123).
 *
 * This is the single most dangerous line in the importer: `new Date(str)` on a
 * UTC runtime would shift every booking 5–6 hours and match no slot at all,
 * silently, which then looks like "FareHarbor times aren't in our schedule".
 */
export function parseLocalDateTime(
  dateRaw: string,
  timeRaw: string | null,
  timezone: string,
): Date | null {
  return parseLocalDateTimeDetailed(dateRaw, timeRaw, timezone).instant;
}

export type ParsedDateTime = {
  instant: Date | null;
  /**
   * True when the wall-clock reading we parsed isn't the one we were given —
   * i.e. the local time doesn't exist (spring-forward gap) and luxon pushed it
   * forward an hour. `expandScheduleToSlots` skips such times outright, so a
   * shifted booking would match no slot AND be an hour off. Vanishingly rare
   * for tour start times, but it must be reported, never applied silently.
   */
  dstShifted: boolean;
};

export function parseLocalDateTimeDetailed(
  dateRaw: string,
  timeRaw: string | null,
  timezone: string,
): ParsedDateTime {
  const date = (dateRaw ?? "").trim();
  if (!date) return { instant: null, dstShifted: false };
  const time = (timeRaw ?? "").trim();
  const combined = time ? `${date} ${time}` : date;

  // Compare against the same string parsed in UTC, which applies no DST rules
  // and so preserves the wall clock exactly as written. If the zone-aware parse
  // reads a different hour, luxon silently moved a nonexistent local time.
  const finish = (dt: DateTime, plain: DateTime): ParsedDateTime => {
    const local = dt.setZone(timezone);
    const shifted =
      plain.isValid &&
      (local.hour !== plain.hour ||
        local.minute !== plain.minute ||
        local.day !== plain.day);
    return { instant: dt.toUTC().toJSDate(), dstShifted: shifted };
  };

  for (const fmt of DATETIME_FORMATS) {
    const dt = DateTime.fromFormat(combined, fmt, { zone: timezone });
    if (dt.isValid) {
      return finish(dt, DateTime.fromFormat(combined, fmt, { zone: "utc" }));
    }
  }
  const iso = DateTime.fromISO(combined, { zone: timezone });
  if (iso.isValid) {
    return finish(iso, DateTime.fromISO(combined, { zone: "utc" }));
  }

  const sql = DateTime.fromSQL(combined, { zone: timezone });
  if (sql.isValid) {
    return finish(sql, DateTime.fromSQL(combined, { zone: "utc" }));
  }

  return { instant: null, dstShifted: false };
}

/** Render an instant back in location-local time — used to prove the timezone
 *  read correctly in the dry-run report before anything is written. */
export function formatLocal(d: Date, timezone: string): string {
  return DateTime.fromJSDate(d, { zone: timezone }).toFormat("ccc LLL d, yyyy h:mm a");
}

/**
 * US-centric E.164 normalization, matching what the booking flow stores.
 * Returns null rather than guessing when the digits don't look like a phone
 * number — a wrong number on a manifest is worse than a blank one.
 */
export function normalizePhone(raw: string): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (s.startsWith("+")) {
    const digits = s.replace(/[^\d]/g, "");
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  const digits = s.replace(/[^\d]/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** Split a full name into first/last the way the manifest renders it. */
export function splitName(raw: string): { firstName: string | null; lastName: string | null } {
  const s = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!s) return { firstName: null, lastName: null };
  // "Smith, John" (FareHarbor's usual ordering) → John Smith
  if (s.includes(",")) {
    const [last, first] = s.split(",", 2).map((p) => p.trim());
    return { firstName: first || null, lastName: last || null };
  }
  const parts = s.split(" ");
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

/**
 * Synthesized address for a booking with no email. MUST be per-booking:
 * `customers` is unique on (location_id, email_lower), so reusing one blank
 * value would collapse every such guest into a single customer row and the
 * manifest would show the last-imported name for all of them.
 * `.invalid` is reserved by RFC 2606 and can never route mail.
 */
export function syntheticEmail(externalRef: string): string {
  const safe = externalRef.toLowerCase().replace(/[^a-z0-9]/g, "") || "unknown";
  return `fh-${safe}@import.invalid`;
}

/** True for addresses we synthesized — never send mail to these. */
export function isSyntheticEmail(email: string | null | undefined): boolean {
  return !!email && email.endsWith("@import.invalid");
}

/** Cells that mean "this booking was cancelled" in a status-ish column. */
const CANCELLED_VALUES = new Set([
  "cancelled", "canceled", "cancelled booking", "yes", "true", "1", "void", "refunded",
]);

export function looksCancelled(raw: string): boolean {
  return CANCELLED_VALUES.has((raw ?? "").trim().toLowerCase());
}

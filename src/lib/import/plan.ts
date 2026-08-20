import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  availabilities,
  availabilitySchedules,
  bookingLines,
  bookings,
  customerTypes,
  getDb,
  itemCustomerTypes,
  items,
  locations,
  resourceRequirements,
  resources,
} from "@/lib/db";
import { normalizeHeader, type Table } from "./csv";
import {
  formatLocal,
  looksCancelled,
  normalizePhone,
  parseLocalDateTimeDetailed,
  parseMoneyCents,
  splitName,
  syntheticEmail,
  type ColumnMapping,
} from "./fareharbor";
import type { ImportPlan, PlannedLine, PlannedRow, RowIssue, SlotPressure } from "./types";
import { BLOCKING } from "./types";

// Turn a parsed CSV into a fully-resolved, write-ready plan. Reads the catalog
// but writes NOTHING — the dry run renders this, and the commit consumes the
// same object, so the operator approves exactly what lands.

type CtPrice = { id: string; name: string; priceCents: number };

/**
 * Recover the rider-type split from money the source didn't break out.
 * FareHarbor's export gives a unit count and a subtotal but no per-rider-type
 * lines, so with two priced types we solve
 *   a + b = units,  p1·a + p2·b = subtotal
 * which has a single integer solution when one exists. Returns null when the
 * numbers don't resolve (e.g. a discount was applied), and the caller falls
 * back to the cheapest type plus a subtotal override that preserves the money.
 */
export function solveRiderMix(
  units: number,
  subtotalCents: number,
  types: CtPrice[],
): { type: CtPrice; quantity: number }[] | null {
  if (units <= 0 || types.length === 0) return null;
  const sorted = [...types].sort((a, b) => a.priceCents - b.priceCents);

  if (sorted.length === 1) {
    return sorted[0].priceCents * units === subtotalCents
      ? [{ type: sorted[0], quantity: units }]
      : null;
  }
  if (sorted.length === 2) {
    const [p1, p2] = sorted;
    const spread = p2.priceCents - p1.priceCents;
    if (spread === 0) {
      return p1.priceCents * units === subtotalCents
        ? [{ type: p1, quantity: units }]
        : null;
    }
    const b = (subtotalCents - p1.priceCents * units) / spread;
    if (!Number.isInteger(b) || b < 0 || b > units) return null;
    const a = units - b;
    const out: { type: CtPrice; quantity: number }[] = [];
    if (a > 0) out.push({ type: p1, quantity: a });
    if (b > 0) out.push({ type: p2, quantity: b });
    return out.length ? out : null;
  }
  // Three or more priced types is ambiguous from a single subtotal; don't guess.
  return null;
}

function issue(code: RowIssue["code"], detail?: string): RowIssue {
  return { code, severity: BLOCKING.has(code) ? "error" : "warning", detail };
}

export async function buildPlan(opts: {
  slug: string;
  table: Table;
  mapping: ColumnMapping;
  fileName: string;
  delimiter: string;
  /** Create one-off slots for datetimes with no materialized availability. */
  allowSlotCreate: boolean;
  /**
   * Record bookings even where the slot is already at or over capacity.
   *
   * The capacity guard exists to stop US from selling a seat that does not
   * exist. It is the wrong tool for an import, where the booking ALREADY
   * happened in the source system and the customer will arrive regardless —
   * refusing the row does not free an ATV, it just means our manifest is
   * missing someone who shows up. Off by default so a normal import still
   * catches a genuine mistake.
   */
  allowOverbook?: boolean;
  /**
   * Map a FareHarbor tour name onto one of ours, e.g.
   * `{ "H-Town 1 Hour ATV Tour": "1-Hour ATV Tour" }`.
   *
   * Needed because the name a location used in FareHarbor is rarely the name we
   * gave the same tour — Houston's "H-Town 1 Hour ATV Tour" is our "1-Hour ATV
   * Tour". Without this the rows come back `unmapped_item` and the operator's
   * only options are to rename a live, customer-facing product or hand-edit the
   * CSV. Deliberately EXPLICIT rather than fuzzy: silently matching the wrong
   * tour would file bookings against the wrong capacity pool and price.
   */
  itemAliases?: Record<string, string>;
}): Promise<ImportPlan> {
  const db = getDb();
  const [loc] = await db.select().from(locations).where(eq(locations.slug, opts.slug)).limit(1);
  if (!loc) throw new Error(`No location with slug "${opts.slug}"`);
  const tz = loc.timezone ?? "America/Chicago";

  // Catalog
  const itemRows = await db.select().from(items).where(eq(items.locationId, loc.id));
  const byItemName = new Map<string, (typeof itemRows)[number]>();
  for (const it of itemRows) byItemName.set(normalizeHeader(it.name), it);

  // Operator-supplied aliases, normalised on both sides so casing and
  // punctuation differences ("1-Hour" vs "1 Hour") don't defeat them.
  const aliases = new Map<string, string>();
  for (const [from, to] of Object.entries(opts.itemAliases ?? {}))
    aliases.set(normalizeHeader(from), normalizeHeader(to));

  const resolveItem = (sourceName: string) => {
    const key = normalizeHeader(sourceName);
    const aliased = aliases.get(key);
    return byItemName.get(aliased ?? key) ?? null;
  };

  const priceRows = await db
    .select({
      itemId: itemCustomerTypes.itemId,
      ctId: customerTypes.id,
      name: customerTypes.singular,
      priceCents: itemCustomerTypes.priceCents,
    })
    .from(itemCustomerTypes)
    .innerJoin(customerTypes, eq(customerTypes.id, itemCustomerTypes.customerTypeId))
    .where(
      and(
        inArray(
          itemCustomerTypes.itemId,
          itemRows.length ? itemRows.map((i) => i.id) : ["00000000-0000-0000-0000-000000000000"],
        ),
        eq(customerTypes.archived, false),
      ),
    );
  const pricesByItem = new Map<string, CtPrice[]>();
  for (const p of priceRows) {
    const arr = pricesByItem.get(p.itemId) ?? [];
    arr.push({ id: p.ctId, name: p.name, priceCents: p.priceCents });
    pricesByItem.set(p.itemId, arr);
  }

  // Existing slots for this location, keyed by (itemId, instant).
  const slotRows = await db
    .select({ id: availabilities.id, itemId: availabilities.itemId, startsAt: availabilities.startsAt })
    .from(availabilities)
    .innerJoin(items, eq(items.id, availabilities.itemId))
    .where(eq(items.locationId, loc.id));
  const slotKey = (itemId: string, at: Date) => `${itemId}@${at.getTime()}`;
  const slotByKey = new Map<string, string>();
  for (const s of slotRows) slotByKey.set(slotKey(s.itemId, new Date(s.startsAt)), s.id);

  // Already-imported refs, so a re-run reports duplicates instead of failing.
  const existingRefs = new Set(
    (
      await db
        .select({ ref: bookings.externalRef })
        .from(bookings)
        .where(and(eq(bookings.locationId, loc.id), isNotNull(bookings.externalRef)))
    ).map((r) => r.ref as string),
  );

  // Capacity: units already booked per slot, and the per-item resource ceiling.
  const bookedRows = await db
    .select({
      availabilityId: bookings.availabilityId,
      qty: sql<number>`coalesce(sum(${bookingLines.quantity}), 0)::int`,
    })
    .from(bookings)
    .innerJoin(bookingLines, eq(bookingLines.bookingId, bookings.id))
    .where(and(eq(bookings.locationId, loc.id), eq(bookings.status, "active")))
    .groupBy(bookings.availabilityId);
  const bookedBySlot = new Map<string, number>();
  for (const b of bookedRows) bookedBySlot.set(b.availabilityId, Number(b.qty));

  const resRows = await db
    .select({ itemId: resourceRequirements.itemId, max: resources.maxConcurrentUses, oos: resources.outOfServiceCount })
    .from(resourceRequirements)
    .innerJoin(resources, eq(resources.id, resourceRequirements.resourceId))
    .where(eq(resources.locationId, loc.id));
  const resourceCapByItem = new Map<string, number>();
  for (const r of resRows) {
    const cap = Math.max(0, r.max - r.oos);
    const cur = resourceCapByItem.get(r.itemId);
    resourceCapByItem.set(r.itemId, cur == null ? cap : Math.min(cur, cap));
  }

  const schedCap = new Map<string, number | null>();
  for (const s of await db
    .select({ id: availabilitySchedules.id, cap: availabilitySchedules.capacityPerSlot })
    .from(availabilitySchedules)) {
    schedCap.set(s.id, s.cap);
  }

  // ── Walk the file ────────────────────────────────────────────────────────
  const m = opts.mapping;
  const get = (r: Record<string, string>, k: keyof ColumnMapping): string =>
    m[k] ? (r[m[k] as string] ?? "").trim() : "";

  const seenRefs = new Set<string>();
  const rows: PlannedRow[] = [];
  const itemCounts = new Map<string, number>();
  const now = Date.now();

  opts.table.rows.forEach((raw, idx) => {
    const sourceLine = idx + 3; // +1 header, +1 banner row, +1 to 1-base
    const issues: RowIssue[] = [];
    const rawRef = get(raw, "externalRef");

    // FareHarbor appends a totals row with every key field blank. Skip it
    // entirely rather than reporting it as a broken booking.
    const looksLikeTotalsRow =
      !rawRef && !get(raw, "itemName") && !get(raw, "customerName") && !get(raw, "startDate");
    if (looksLikeTotalsRow) return;

    const externalRef = rawRef ? `fh:${rawRef.replace(/^#/, "")}` : "";
    if (!externalRef) issues.push(issue("missing_booking_ref"));
    else if (seenRefs.has(externalRef)) issues.push(issue("duplicate_ref_in_file", rawRef));
    seenRefs.add(externalRef);

    const alreadyImported = externalRef ? existingRefs.has(externalRef) : false;
    if (alreadyImported) issues.push(issue("already_imported"));

    const cancelled = looksCancelled(get(raw, "status"));
    if (cancelled) issues.push(issue("cancelled_in_source"));

    // Item
    const sourceItem = get(raw, "itemName");
    itemCounts.set(sourceItem, (itemCounts.get(sourceItem) ?? 0) + 1);
    const item = resolveItem(sourceItem);
    if (!item) issues.push(issue("unmapped_item", sourceItem || "(blank)"));

    // When
    const parsed = parseLocalDateTimeDetailed(get(raw, "startDate"), get(raw, "startTime") || null, tz);
    if (!get(raw, "startDate")) issues.push(issue("missing_datetime"));
    else if (!parsed.instant) issues.push(issue("bad_datetime", get(raw, "startDate")));
    if (parsed.dstShifted) issues.push(issue("dst_shifted", "local time does not exist on this date"));
    if (parsed.instant && parsed.instant.getTime() < now) issues.push(issue("past_datetime"));

    // Slot
    let availabilityId: string | null = null;
    let willCreateSlot = false;
    if (item && parsed.instant) {
      availabilityId = slotByKey.get(slotKey(item.id, parsed.instant)) ?? null;
      if (!availabilityId) {
        if (opts.allowSlotCreate) {
          willCreateSlot = true;
          issues.push(issue("slot_will_be_created"));
        } else {
          issues.push(issue("unmatched_slot", parsed.instant ? formatLocal(parsed.instant, tz) : ""));
        }
      }
    }

    // Money
    const subtotalCents = parseMoneyCents(get(raw, "subtotalCents") || get(raw, "totalCents"));
    const taxCents = parseMoneyCents(get(raw, "taxCents")) ?? 0;
    const paidCents = parseMoneyCents(get(raw, "paidCents")) ?? 0;
    const dueParsed = parseMoneyCents(get(raw, "dueCents"));

    // FareHarbor's "Custom bookings report" ships Subtotal / Total Paid /
    // Amount Due but NO "Total" column, so the header mapper has nothing to
    // bind `totalCents` to and every row used to fail on missing_total. Paid +
    // Due is the booking total by definition, and unlike Subtotal it includes
    // tax and fees — deriving it is strictly better than rejecting the file or
    // falling back to a pre-tax number that would understate what is owed.
    const totalParsed = parseMoneyCents(get(raw, "totalCents"));
    const totalCents =
      totalParsed ?? (dueParsed != null ? paidCents + dueParsed : null);
    if (totalCents == null) issues.push(issue("missing_total"));
    else if (totalParsed == null) issues.push(issue("total_derived_from_paid_plus_due"));
    if (subtotalCents == null) issues.push(issue("bad_money", "subtotal"));

    // Units + rider mix
    const units = Number(get(raw, "quantity"));
    if (!Number.isFinite(units) || units <= 0) issues.push(issue("zero_quantity"));

    const cts = item ? (pricesByItem.get(item.id) ?? []) : [];
    if (item && cts.length === 0) issues.push(issue("no_customer_types", item.name));

    let lines: PlannedLine[] = [];
    if (item && cts.length && Number.isFinite(units) && units > 0 && subtotalCents != null) {
      const solved = solveRiderMix(units, subtotalCents, cts);
      if (solved) {
        lines = solved.map((s) => ({
          customerTypeId: s.type.id,
          customerTypeName: s.type.name,
          quantity: s.quantity,
          unitPriceCents: s.type.priceCents,
        }));
      } else {
        // Money doesn't resolve to a clean mix (usually a discount). Put every
        // unit on the cheapest type and preserve the source total via an
        // override, so the customer is never asked for a different amount.
        const cheapest = [...cts].sort((a, b) => a.priceCents - b.priceCents)[0];
        lines = [
          {
            customerTypeId: cheapest.id,
            customerTypeName: cheapest.name,
            quantity: units,
            unitPriceCents: cheapest.priceCents,
          },
        ];
        issues.push(
          issue("rider_mix_estimated", `${units} × ${cheapest.name}; total preserved via override`),
        );
      }
    }

    const lineSum = lines.reduce((s, l) => s + l.quantity * l.unitPriceCents, 0);
    const subtotalCentsOverride =
      subtotalCents != null && lineSum !== subtotalCents ? subtotalCents : null;

    // Contact
    const nameRaw = get(raw, "customerName");
    if (!nameRaw) issues.push(issue("missing_name"));
    const { firstName, lastName } = splitName(nameRaw);
    const emailRaw = get(raw, "customerEmail").toLowerCase();
    const synthetic = !emailRaw;
    if (synthetic) issues.push(issue("missing_email"));
    const emailLower = emailRaw || syntheticEmail(rawRef || String(sourceLine));
    const phoneRaw = get(raw, "customerPhone");
    const phoneE164 = normalizePhone(phoneRaw);
    if (phoneRaw && !phoneE164) issues.push(issue("bad_phone", phoneRaw));

    const srcNotes = get(raw, "notes");
    const notes = [rawRef ? `[FareHarbor ${rawRef}]` : null, srcNotes || null]
      .filter(Boolean)
      .join(" ") || null;

    const total = totalCents ?? 0;
    const balanceDueCents = dueParsed ?? Math.max(0, total - paidCents);

    rows.push({
      sourceLine,
      externalRef,
      rawRef,
      itemId: item?.id ?? null,
      itemName: sourceItem,
      startsAt: parsed.instant,
      startsAtLocal: parsed.instant ? formatLocal(parsed.instant, tz) : "—",
      availabilityId,
      willCreateSlot,
      firstName,
      lastName,
      emailLower,
      syntheticEmail: synthetic,
      phoneE164,
      lines,
      units: Number.isFinite(units) ? units : 0,
      subtotalCents: subtotalCents ?? 0,
      taxCents,
      totalCents: total,
      depositPaidCents: paidCents,
      balanceDueCents,
      subtotalCentsOverride,
      notes,
      issues,
      blocked: issues.some((i) => i.severity === "error"),
      alreadyImported,
    });
  });

  // ── Capacity pressure, counting this batch against what's already booked ──
  const pressure = new Map<string, SlotPressure>();
  for (const r of rows) {
    if (r.blocked || r.alreadyImported || !r.itemId) continue;
    const key = r.availabilityId ?? `new:${r.itemId}@${r.startsAt?.getTime()}`;
    const cap = resourceCapByItem.get(r.itemId) ?? null;
    const cur =
      pressure.get(key) ??
      ({
        availabilityId: r.availabilityId,
        startsAtLocal: r.startsAtLocal,
        existingUnits: r.availabilityId ? (bookedBySlot.get(r.availabilityId) ?? 0) : 0,
        incomingUnits: 0,
        capacity: cap,
        over: false,
      } satisfies SlotPressure);
    cur.incomingUnits += r.units;
    cur.over = cap != null && cur.existingUnits + cur.incomingUnits > cap;
    pressure.set(key, cur);
  }
  // Flag the rows sitting in an over-subscribed slot. Under --allow-overbook
  // this is still reported on every affected row, just not blocking, so the
  // operator gets an explicit list of the slots their team has to call.
  for (const r of rows) {
    if (r.blocked || r.alreadyImported || !r.itemId) continue;
    const key = r.availabilityId ?? `new:${r.itemId}@${r.startsAt?.getTime()}`;
    const p = pressure.get(key);
    if (p?.over) {
      const detail = `${p.existingUnits + p.incomingUnits} of ${p.capacity}`;
      if (opts.allowOverbook) {
        r.issues.push(issue("overbooked_slot", detail));
      } else {
        r.issues.push(issue("insufficient_capacity", detail));
        r.blocked = true;
      }
    }
  }

  const importable = rows.filter((r) => !r.blocked && !r.alreadyImported);
  return {
    locationSlug: opts.slug,
    timezone: tz,
    fileName: opts.fileName,
    delimiter: opts.delimiter,
    headers: opts.table.headers,
    sourceRows: rows.length,
    raggedRows: opts.table.raggedRows,
    rows,
    slotPressure: [...pressure.values()].sort((a, b) => b.incomingUnits - a.incomingUnits),
    itemMapping: [...itemCounts].map(([sourceName, bookingsCount]) => {
      const it = resolveItem(sourceName);
      return { sourceName, itemId: it?.id ?? null, itemName: it?.name ?? null, bookings: bookingsCount };
    }),
    totals: {
      importable: importable.length,
      blocked: rows.filter((r) => r.blocked).length,
      alreadyImported: rows.filter((r) => r.alreadyImported).length,
      cancelled: rows.filter((r) => r.issues.some((i) => i.code === "cancelled_in_source")).length,
      units: importable.reduce((s, r) => s + r.units, 0),
      totalCents: importable.reduce((s, r) => s + r.totalCents, 0),
      depositPaidCents: importable.reduce((s, r) => s + r.depositPaidCents, 0),
      balanceDueCents: importable.reduce((s, r) => s + r.balanceDueCents, 0),
      slotsToCreate: new Set(
        importable.filter((r) => r.willCreateSlot).map((r) => `${r.itemId}@${r.startsAt?.getTime()}`),
      ).size,
    },
  };
}

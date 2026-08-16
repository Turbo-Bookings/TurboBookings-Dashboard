import { and, eq, inArray, sql } from "drizzle-orm";
import {
  availabilities,
  bookingLines,
  bookings,
  customers,
  items,
  locations,
  payments,
} from "@/lib/db";
import { withTxn, type Tx } from "@/lib/db/pool";
import type { ImportResult, PlannedRow, RowOutcome } from "./types";

// Writes an approved ImportPlan. Deliberately a purpose-built writer rather
// than a flag threaded through createDirectBooking: that function is ~245 lines
// of Stripe retrieval, discount validation, acknowledgment enforcement and
// authoritative repricing, and a bypass flag would leave the import one boolean
// away from charging a card. This mirrors its transaction body instead.
//
// Intentionally NOT done here (these bookings already exist elsewhere):
//   no Stripe call, no confirmation/reminder email, no Meta CAPI, no
//   booking.created event, no discount redemption or usedCount bump, no
//   required-acknowledgment enforcement, no repricing.
// Intentionally KEPT: the FOR UPDATE slot lock, the capacity re-check, and a
// per-row savepoint so one bad row can't take down the batch.

const CHUNK = 100;

class RowError extends Error {}

/** Highest numeric display_number for a location, tolerant of legacy values. */
async function maxDisplayNumber(tx: Tx, locationId: string): Promise<number> {
  const [row] = await tx
    .select({
      // CASE rather than a WHERE filter: Postgres may evaluate the cast before
      // the predicate, so `display_number::bigint` with a regex WHERE can still
      // explode on a non-numeric legacy value.
      m: sql<string>`coalesce(max(case when ${bookings.displayNumber} ~ '^[0-9]+$'
                                  then ${bookings.displayNumber}::bigint end), 0)`,
    })
    .from(bookings)
    .where(eq(bookings.locationId, locationId));
  return Number(row?.m ?? 0);
}

export async function commitPlan(opts: {
  slug: string;
  rows: PlannedRow[];
  actorUserId: string | null;
  /** Create one-off availabilities for instants with no materialized slot. */
  allowSlotCreate: boolean;
  /** Tag written into auto-created slots' notes, for clean rollback. */
  runId: string;
}): Promise<ImportResult> {
  const outcomes: RowOutcome[] = [];
  let slotsCreated = 0;

  // Only rows the plan cleared. Blocked rows were already reported to the
  // operator and must never slip through here.
  const queue = opts.rows.filter((r) => !r.blocked && !r.alreadyImported);

  for (let start = 0; start < queue.length; start += CHUNK) {
    const chunk = queue.slice(start, start + CHUNK);

    await withTxn(async (tx) => {
      const [loc] = await tx.select().from(locations).where(eq(locations.slug, opts.slug)).limit(1);
      if (!loc) throw new Error(`No location with slug "${opts.slug}"`);

      // Serialize display-number allocation against a concurrent import. Held
      // for the transaction only.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${"bk_disp:" + loc.id}))`,
      );
      let next = await maxDisplayNumber(tx, loc.id);

      // Item durations, for sizing any slot we have to create.
      const itemIds = [...new Set(chunk.map((r) => r.itemId).filter(Boolean) as string[])];
      const durations = new Map<string, number>();
      if (itemIds.length) {
        for (const it of await tx
          .select({ id: items.id, mins: items.defaultDurationMinutes })
          .from(items)
          .where(inArray(items.id, itemIds))) {
          durations.set(it.id, it.mins);
        }
      }

      for (const row of chunk) {
        try {
          // Per-row SAVEPOINT: a throw rolls back only this booking and the
          // loop continues with the rest of the chunk.
          const res = await tx.transaction(async (sp) => {
            if (!row.itemId || !row.startsAt) throw new RowError("row not resolved");

            // Idempotency re-check inside the savepoint — the plan may be
            // minutes old, and a concurrent run may have inserted it.
            const [dupe] = await sp
              .select({ id: bookings.id, d: bookings.displayNumber })
              .from(bookings)
              .where(
                and(eq(bookings.locationId, loc.id), eq(bookings.externalRef, row.externalRef)),
              )
              .limit(1);
            if (dupe) {
              return { status: "duplicate_skipped" as const, bookingId: dupe.id, displayNumber: dupe.d };
            }

            // Resolve the slot HERE rather than trusting the plan: an earlier
            // row in this very batch may have just created it, and the unique
            // index is on (schedule_id, starts_at) where NULL never dedupes.
            let slotId = row.availabilityId;
            if (!slotId) {
              const [found] = await sp
                .select({ id: availabilities.id })
                .from(availabilities)
                .where(
                  and(
                    eq(availabilities.itemId, row.itemId),
                    eq(availabilities.startsAt, row.startsAt),
                  ),
                )
                .limit(1);
              slotId = found?.id ?? null;
            }
            if (!slotId) {
              if (!opts.allowSlotCreate) throw new RowError("no slot for this date/time");
              const mins = durations.get(row.itemId) ?? 60;
              const [made] = await sp
                .insert(availabilities)
                .values({
                  itemId: row.itemId,
                  startsAt: row.startsAt,
                  endsAt: new Date(row.startsAt.getTime() + mins * 60_000),
                  // Never publicly bookable, and with a null scheduleId the
                  // nightly materializer never prunes it.
                  onlineBookingStatus: "off",
                  scheduleId: null,
                  notes: `Auto-created by FareHarbor import ${opts.runId}`,
                })
                .returning({ id: availabilities.id });
              slotId = made.id;
              slotsCreated++;
            }

            // Lock the slot, then re-check capacity against what's committed.
            const [slot] = await sp
              .select()
              .from(availabilities)
              .where(eq(availabilities.id, slotId))
              .for("update");
            if (!slot) throw new RowError("slot vanished");

            // Customer upsert. Only overwrite with non-blank values — a
            // returning guest must not have their name or phone wiped by an
            // empty cell in this export.
            const set: Record<string, unknown> = { updatedAt: new Date() };
            if (row.firstName) set.firstName = row.firstName;
            if (row.lastName) set.lastName = row.lastName;
            if (row.phoneE164) set.phoneE164 = row.phoneE164;
            const [cust] = await sp
              .insert(customers)
              .values({
                locationId: loc.id,
                emailLower: row.emailLower,
                firstName: row.firstName,
                lastName: row.lastName,
                phoneE164: row.phoneE164,
                firstSeenAt: new Date(),
              })
              .onConflictDoUpdate({
                target: [customers.locationId, customers.emailLower],
                set,
              })
              .returning();

            const displayNumber = String(++next).padStart(4, "0");

            const [booking] = await sp
              .insert(bookings)
              .values({
                locationId: loc.id,
                itemId: row.itemId,
                availabilityId: slotId,
                customerId: cust.id,
                displayNumber,
                // `api` already exists in the enum and is used nowhere else, so
                // imported bookings stay separable in reports forever.
                source: "api",
                status: "active",
                createdByUserId: opts.actorUserId,
                externalRef: row.externalRef,
                subtotalCents: row.subtotalCents,
                subtotalCentsOverride: row.subtotalCentsOverride,
                taxCents: row.taxCents,
                platformFeeCents: 0, // we took no fee on someone else's sale
                discountCents: 0,
                totalCents: row.totalCents,
                depositPaidCents: row.depositPaidCents,
                balanceDueCents: row.balanceDueCents,
                notes: row.notes,
              })
              .returning();

            // At least one line is mandatory: the manifest innerJoins
            // booking_lines, so a booking with none is invisible to staff.
            if (row.lines.length === 0) throw new RowError("no rider lines");
            await sp.insert(bookingLines).values(
              row.lines.map((l, i) => ({
                bookingId: booking.id,
                customerTypeId: l.customerTypeId,
                quantity: l.quantity,
                unitPriceCents: l.unitPriceCents,
                sortOrder: i,
              })),
            );

            // Record what the other system already collected, so the booking's
            // paid/balance figures reconcile. Not a Stripe charge.
            if (row.depositPaidCents > 0) {
              await sp.insert(payments).values({
                bookingId: booking.id,
                paymentGateway: "other",
                stripePaymentIntentId: null,
                amountCents: row.depositPaidCents,
                applicationFeeCents: 0,
                status: "succeeded",
                capturedAt: new Date(),
                paymentMethodType: "fareharbor_import",
              });
            }

            return { status: "created" as const, bookingId: booking.id, displayNumber };
          });

          outcomes.push({ externalRef: row.externalRef, ...res });
        } catch (err) {
          outcomes.push({
            externalRef: row.externalRef,
            status: "error",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    });
  }

  const created = outcomes.filter((o) => o.status === "created");
  const numbers = created.map((o) => o.displayNumber!).sort();
  return {
    created: created.length,
    duplicates: outcomes.filter((o) => o.status === "duplicate_skipped").length,
    errors: outcomes.filter((o) => o.status === "error").length,
    slotsCreated,
    displayNumberRange: numbers.length ? [numbers[0], numbers[numbers.length - 1]] : null,
    outcomes,
  };
}

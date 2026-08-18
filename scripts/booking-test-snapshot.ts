/**
 * Capture / compare a full state snapshot around a live test booking.
 *
 * Run once BEFORE the test booking to write a baseline, then again after with
 * --diff to see exactly what the booking touched. Diffing beats eyeballing: it
 * catches the things that are supposed to happen but silently don't (no payment
 * row, no scheduled emails, no outbound event) as readily as the things that do.
 *
 * Usage:
 *   npm run booking:snapshot -- <slug>            # write baseline
 *   npm run booking:snapshot -- <slug> --diff     # compare against baseline
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { sql } from "drizzle-orm";
import { withTxn } from "../src/lib/db/pool";

const slug = process.argv[2];
const diff = process.argv.includes("--diff");
if (!slug) {
  console.error("usage: npm run booking:snapshot -- <slug> [--diff]");
  process.exit(1);
}
const FILE = `/tmp/booking-snapshot-${slug}.json`;

const COUNTS: Record<string, string> = {
  bookings: `select count(*)::int n from bookings b join locations l on l.id=b.location_id where l.slug='${slug}'`,
  booking_lines: `select count(*)::int n from booking_lines bl join bookings b on b.id=bl.booking_id join locations l on l.id=b.location_id where l.slug='${slug}'`,
  payments: `select count(*)::int n from payments p join bookings b on b.id=p.booking_id join locations l on l.id=b.location_id where l.slug='${slug}'`,
  customers: `select count(*)::int n from customers c join locations l on l.id=c.location_id where l.slug='${slug}'`,
  scheduled_emails: `select count(*)::int n from scheduled_emails se join bookings b on b.id=se.booking_id join locations l on l.id=b.location_id where l.slug='${slug}'`,
  emails_sent: `select count(*)::int n from scheduled_emails se join bookings b on b.id=se.booking_id join locations l on l.id=b.location_id where l.slug='${slug}' and se.sent_at is not null`,
  outbound_events: `select count(*)::int n from outbound_event_queue`,
  payment_methods: `select count(*)::int n from payment_methods_on_file pm join customers c on c.id=pm.customer_id join locations l on l.id=c.location_id where l.slug='${slug}'`,
};

async function main() {
  await withTxn(async (tx) => {
    const snap: Record<string, number> = {};
    for (const [k, q] of Object.entries(COUNTS)) {
      const r: any = await tx.execute(sql.raw(q));
      snap[k] = (r.rows ?? r)[0].n;
    }

    if (!diff) {
      writeFileSync(FILE, JSON.stringify(snap, null, 2));
      console.log(`\nBaseline written to ${FILE}\n`);
      console.table(snap);
      return;
    }

    if (!existsSync(FILE)) {
      console.error(`No baseline at ${FILE} — run without --diff first.`);
      process.exit(1);
    }
    const before = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, number>;
    const rows = Object.keys(COUNTS).map((k) => ({
      table: k,
      before: before[k],
      after: snap[k],
      delta: snap[k] - before[k],
    }));
    console.log("\n=== What the booking changed ===");
    console.table(rows);

    const expected: Record<string, number> = {
      bookings: 1,
      payments: 1,
      customers: 1,
    };
    const problems: string[] = [];
    for (const [k, want] of Object.entries(expected)) {
      const got = snap[k] - before[k];
      if (got < want) {
        problems.push(`${k}: expected +${want}, got +${got}`);
      }
    }
    if (snap.booking_lines - before.booking_lines < 1)
      problems.push("booking_lines: no rider lines written — the booking has no contents");
    if (snap.scheduled_emails - before.scheduled_emails < 1)
      problems.push(
        "scheduled_emails: no reminders armed for the new booking — sendBookingLifecycleEmails did not run or the slot is <2h out",
      );
    if (snap.outbound_events - before.outbound_events < 1)
      problems.push(
        "outbound_event_queue: no booking.created event emitted — the cockpit revenue feed will not see this sale",
      );

    if (problems.length) {
      console.log("PROBLEMS:");
      for (const p of problems) console.log(`  - ${p}`);
    } else {
      console.log("All expected rows were written.\n");
    }
  });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e.cause?.message ?? e.message);
    process.exit(1);
  });

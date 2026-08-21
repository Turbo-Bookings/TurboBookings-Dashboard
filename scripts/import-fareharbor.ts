/**
 * FareHarbor booking importer.
 *
 *   npm run import:fh -- --file=export.csv --slug=dtown            # dry run
 *   npm run import:fh -- --file=export.csv --slug=dtown --commit
 *   npm run import:fh -- --slug=dtown --arm-reminders              # later
 *
 * DRY RUN BY DEFAULT — nothing is written without --commit.
 *
 * Flags:
 *   --file=<path>       the FareHarbor CSV export
 *   --slug=<location>   which location to import into
 *   --commit            actually write (otherwise report only)
 *   --create-slots      create one-off availabilities for unmatched datetimes
 *   --map-item="A=B"    map FareHarbor tour "A" onto our tour "B". Repeatable.
 *                       The name a location used in FareHarbor is rarely the
 *                       name we gave the same tour, e.g.
 *                       --map-item="H-Town 1 Hour ATV Tour=1-Hour ATV Tour"
 *   --allow-overbook    import rows whose slot is already at/over capacity.
 *                       The booking already happened in the source system, so
 *                       refusing it does not free a vehicle — it just hides
 *                       someone who will show up. Affected rows are listed as
 *                       `overbooked_slot` so the team knows who to call.
 *   --arm-reminders     schedule 24h/2h reminders for ALREADY-imported bookings
 *                       (no confirmation, no review) — run this once the new
 *                       system is live and FareHarbor's own reminders are off
 *   --limit=<n>         only process the first n rows (rehearsal)
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { and, eq, isNotNull } from "drizzle-orm";
import { bookings, customers, getDb, locations } from "@/lib/db";
import { guardEncoding, parseCsv, sniffDelimiter, toTable } from "@/lib/import/csv";
import { suggestMapping } from "@/lib/import/fareharbor";
import { buildPlan } from "@/lib/import/plan";
import { commitPlan } from "@/lib/import/commit";
import { notifyManualBookingEmails } from "@/lib/booking/lifecycleTrigger";
import type { ImportPlan } from "@/lib/import/types";

const argv = process.argv;
const flag = (n: string) => argv.includes(`--${n}`);
const arg = (n: string): string | null => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : null;
};

// Repeatable --map-item="From=To". Split on the FIRST "=" only, because tour
// names may legitimately contain one.
const itemAliases: Record<string, string> = {};
for (const a of argv.filter((x) => x.startsWith("--map-item="))) {
  const pair = a.slice("--map-item=".length);
  const i = pair.indexOf("=");
  if (i <= 0) {
    console.error(`Bad --map-item (expected "From=To"): ${pair}`);
    process.exit(1);
  }
  itemAliases[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
}

const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

function report(plan: ImportPlan, commit: boolean) {
  console.log(`\n${commit ? "COMMIT" : "DRY RUN — nothing will be written"}`);
  console.log(`file: ${plan.fileName}  ·  delimiter ${JSON.stringify(plan.delimiter)}  ·  ${plan.headers.length} columns`);
  console.log(`location: ${plan.locationSlug}  ·  timezone ${plan.timezone}`);
  if (plan.raggedRows.length) console.log(`! ragged rows (padded): lines ${plan.raggedRows.join(", ")}`);

  console.log("\n— TOUR MAPPING —");
  console.table(
    plan.itemMapping.map((i) => ({
      "from FareHarbor": i.sourceName || "(blank)",
      "→ our tour": i.itemName ?? "*** UNMAPPED ***",
      bookings: i.bookings,
    })),
  );

  console.log("— TIMEZONE CHECK (first 3, rendered in location-local time) —");
  console.table(
    plan.rows.slice(0, 3).map((r) => ({ ref: r.rawRef, "reads as": r.startsAtLocal })),
  );

  console.log("— TOTALS —");
  console.table([
    { "": "importable bookings", value: String(plan.totals.importable) },
    { "": "already imported (skip)", value: String(plan.totals.alreadyImported) },
    { "": "blocked by an error", value: String(plan.totals.blocked) },
    { "": "cancelled in source", value: String(plan.totals.cancelled) },
    { "": "ATV units", value: String(plan.totals.units) },
    { "": "slots to create", value: String(plan.totals.slotsToCreate) },
    { "": "booking value", value: usd(plan.totals.totalCents) },
    { "": "already collected elsewhere", value: usd(plan.totals.depositPaidCents) },
    { "": "BALANCE DUE AT VENUE", value: usd(plan.totals.balanceDueCents) },
  ]);

  const rider = new Map<string, number>();
  for (const r of plan.rows) {
    if (r.blocked || r.alreadyImported) continue;
    for (const l of r.lines) rider.set(l.customerTypeName, (rider.get(l.customerTypeName) ?? 0) + l.quantity);
  }
  console.log("— RIDER MIX —");
  console.table([...rider].map(([type, units]) => ({ type, units })));

  const over = plan.slotPressure.filter((s) => s.over);
  console.log(`— CAPACITY —  slots touched: ${plan.slotPressure.length}  ·  over capacity: ${over.length}`);
  console.table(
    (over.length ? over : plan.slotPressure.slice(0, 5)).map((s) => ({
      when: s.startsAtLocal,
      existing: s.existingUnits,
      incoming: s.incomingUnits,
      capacity: s.capacity ?? "—",
      over: s.over ? "YES" : "",
    })),
  );

  const counts = new Map<string, number>();
  for (const r of plan.rows) for (const i of r.issues) counts.set(`${i.severity}: ${i.code}`, (counts.get(`${i.severity}: ${i.code}`) ?? 0) + 1);
  if (counts.size) {
    console.log("— ISSUES —");
    console.table([...counts].sort().map(([issue, n]) => ({ issue, rows: n })));
  }

  const blocked = plan.rows.filter((r) => r.blocked);
  if (blocked.length) {
    console.log("— BLOCKED ROWS —");
    console.table(
      blocked.slice(0, 25).map((r) => ({
        line: r.sourceLine,
        ref: r.rawRef,
        when: r.startsAtLocal,
        why: r.issues.filter((i) => i.severity === "error").map((i) => i.code).join(", "),
      })),
    );
    if (blocked.length > 25) console.log(`  … and ${blocked.length - 25} more`);
  }

  const notable = plan.rows.filter(
    (r) => !r.blocked && r.issues.some((i) => i.code === "rider_mix_estimated" || i.code === "missing_email" || i.code === "dst_shifted"),
  );
  if (notable.length) {
    console.log("— ROWS THAT NEED A HUMAN EYE (still importable) —");
    console.table(
      notable.map((r) => ({
        ref: r.rawRef,
        when: r.startsAtLocal,
        units: r.units,
        total: usd(r.totalCents),
        note: r.issues.filter((i) => i.severity === "warning").map((i) => i.detail ?? i.code).join("; "),
      })),
    );
  }
}

/** Arm 24h/2h reminders for bookings already imported. No confirmation, no review. */
async function armReminders(slug: string, commit: boolean) {
  const db = getDb();
  const [loc] = await db.select().from(locations).where(eq(locations.slug, slug)).limit(1);
  if (!loc) throw new Error(`No location with slug "${slug}"`);
  const rows = await db
    .select({ id: bookings.id, ref: bookings.externalRef, email: customers.emailLower })
    .from(bookings)
    .innerJoin(customers, eq(customers.id, bookings.customerId))
    .where(
      and(
        eq(bookings.locationId, loc.id),
        eq(bookings.status, "active"),
        isNotNull(bookings.externalRef),
      ),
    );
  // Synthesized addresses can never receive mail; the booking app guards this
  // too, but skipping here keeps the count honest.
  const sendable = rows.filter((r) => !r.email.endsWith("@import.invalid"));
  console.log(
    `\n${commit ? "COMMIT" : "DRY RUN"} — ${sendable.length} imported booking(s) would get 24h/2h reminders ` +
      `(${rows.length - sendable.length} skipped: no real email).`,
  );
  console.log("Only reminders whose send time is still in the future are armed.");
  if (!commit) {
    console.log("\nNothing was written. Re-run with --commit to apply.");
    return;
  }
  // The scheduling happens in the BOOKING APP over an authenticated internal
  // endpoint, so this needs the shared secret. `vercel env pull` returns
  // sensitive values as empty strings, which is how a run on 2026-08-21 reported
  // arming 317 bookings while scheduling none — check before the loop rather
  // than discovering it 317 no-ops later.
  if (!process.env.INTERNAL_API_SECRET) {
    console.error(
      "\nABORTED — INTERNAL_API_SECRET is empty.\n" +
        "  Scheduling runs through the booking app's internal endpoint, and\n" +
        "  `vercel env pull` blanks sensitive values, so this cannot work from a\n" +
        "  pulled env file. Put the real value in .env.local (Vercel dashboard →\n" +
        "  the booking app project → Environment Variables) and re-run.\n" +
        "  Nothing was scheduled.",
    );
    process.exitCode = 1;
    return;
  }

  let ok = 0;
  const failed: string[] = [];
  for (const r of sendable) {
    const sent = await notifyManualBookingEmails(r.id, {
      confirmation: false,
      reminders: true,
      review: false,
    });
    if (sent) ok++;
    else failed.push(r.ref ?? r.id);
  }
  console.log(`Scheduled reminders for ${ok} of ${sendable.length} booking(s).`);
  if (failed.length) {
    console.error(`FAILED for ${failed.length}: ${failed.slice(0, 20).join(", ")}${failed.length > 20 ? " …" : ""}`);
    process.exitCode = 1;
  }
}

async function main() {
  const slug = arg("slug");
  if (!slug) throw new Error("--slug=<location> is required");
  const commit = flag("commit");

  if (flag("arm-reminders")) {
    await armReminders(slug, commit);
    return;
  }

  const file = arg("file");
  if (!file) throw new Error("--file=<path to csv> is required");

  const text = readFileSync(file, "utf8");
  const bad = guardEncoding(text);
  if (bad) throw new Error(bad);

  const all = parseCsv(text);
  // FareHarbor prefixes the export with a one-cell title banner; the real
  // header is the second line.
  const delimiter = sniffDelimiter(text.split(/\r?\n/).slice(1).join("\n"));
  const table = toTable(all.slice(1));
  const mapping = suggestMapping(table.headers);

  const limit = Number(arg("limit") ?? 0);
  if (limit > 0) table.rows = table.rows.slice(0, limit);

  const plan = await buildPlan({
    slug,
    table,
    mapping,
    fileName: basename(file),
    delimiter,
    allowSlotCreate: flag("create-slots"),
    allowOverbook: flag("allow-overbook"),
    itemAliases,
  });

  report(plan, commit);

  if (!commit) {
    console.log("\nNothing was written. Re-run with --commit to apply.");
    return;
  }
  if (plan.totals.importable === 0) {
    console.log("\nNothing importable. Stopping.");
    return;
  }

  const runId = `fh-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}`;
  const result = await commitPlan({
    slug,
    rows: plan.rows,
    actorUserId: null,
    allowSlotCreate: flag("create-slots"),
    runId,
  });

  console.log("\n— RESULT —");
  console.table([
    { "": "created", value: String(result.created) },
    { "": "duplicates skipped", value: String(result.duplicates) },
    { "": "errors", value: String(result.errors) },
    { "": "slots created", value: String(result.slotsCreated) },
    {
      "": "booking numbers",
      value: result.displayNumberRange ? result.displayNumberRange.join(" – ") : "—",
    },
    { "": "run id", value: runId },
  ]);
  const errs = result.outcomes.filter((o) => o.status === "error");
  if (errs.length) {
    console.log("— ERRORS —");
    console.table(errs.slice(0, 25).map((e) => ({ ref: e.externalRef, error: e.error })));
  }
  console.log(
    "\nReminders were NOT scheduled. Run with --arm-reminders once FareHarbor's own reminders are off.",
  );
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("\nimport failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  },
);

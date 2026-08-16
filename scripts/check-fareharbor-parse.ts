/**
 * Self-check for the FareHarbor value parsers.
 *
 * The timezone cases are the point: a booking parsed as UTC instead of Dallas
 * local time lands 5–6 hours off and matches no availability slot, which looks
 * like a schedule problem rather than a parsing bug. Exits non-zero on failure.
 *
 *   npm run check:fh
 */
import { DateTime } from "luxon";
import {
  formatLocal,
  looksCancelled,
  normalizePhone,
  parseLocalDateTime,
  parseLocalDateTimeDetailed,
  parseMoneyCents,
  splitName,
  suggestMapping,
  syntheticEmail,
} from "../src/lib/import/fareharbor";

const TZ = "America/Chicago";
let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}\n       got  ${g}\n       want ${w}`);
  }
}
const iso = (d: Date | null) => (d ? d.toISOString() : null);

console.log("\nparseMoneyCents");
eq("plain", parseMoneyCents("130.00"), 13000);
eq("dollar + comma", parseMoneyCents("$1,234.56"), 123456);
eq("integer", parseMoneyCents("130"), 13000);
eq("zero", parseMoneyCents("0.00"), 0);
eq("parens negative", parseMoneyCents("(12.00)"), -1200);
eq("minus negative", parseMoneyCents("-12.00"), -1200);
eq("usd suffix", parseMoneyCents("130.00 USD"), 13000);
eq("rounding", parseMoneyCents("0.005"), 1);
eq("blank → null", parseMoneyCents(""), null);
eq("garbage → null", parseMoneyCents("n/a"), null);

console.log("\nparseLocalDateTime (America/Chicago)");
// CDT (UTC-5) in summer.
eq("ISO date+time", iso(parseLocalDateTime("2026-09-03", "07:00", TZ)), "2026-09-03T12:00:00.000Z");
eq("US slash + am/pm", iso(parseLocalDateTime("09/03/2026", "7:00 AM", TZ)), "2026-09-03T12:00:00.000Z");
eq("single-digit slash", iso(parseLocalDateTime("9/3/2026", "3:30 PM", TZ)), "2026-09-03T20:30:00.000Z");
eq("long month", iso(parseLocalDateTime("Sep 3, 2026", "7:00 AM", TZ)), "2026-09-03T12:00:00.000Z");
eq("combined single column", iso(parseLocalDateTime("2026-09-03 07:00", null, TZ)), "2026-09-03T12:00:00.000Z");
eq("with seconds", iso(parseLocalDateTime("2026-09-03 07:00:00", null, TZ)), "2026-09-03T12:00:00.000Z");
// CST (UTC-6) in winter — proves we are not hardcoding an offset.
eq("winter is CST not CDT", iso(parseLocalDateTime("2026-12-03", "07:00", TZ)), "2026-12-03T13:00:00.000Z");
eq("blank → null", iso(parseLocalDateTime("", "07:00", TZ)), null);
eq("garbage → null", iso(parseLocalDateTime("not a date", null, TZ)), null);

// The trap this whole function exists to avoid.
const naive = new Date("2026-09-03 07:00");
const correct = parseLocalDateTime("2026-09-03", "07:00", TZ)!;
eq(
  "differs from naive Date parsing (the bug we are preventing)",
  naive.toISOString() !== correct.toISOString() || process.env.TZ === TZ,
  true,
);

console.log("\nformatLocal round-trip");
eq(
  "renders back in location time",
  formatLocal(parseLocalDateTime("2026-09-03", "07:00", TZ)!, TZ),
  "Thu Sep 3, 2026 7:00 AM",
);

console.log("\nDST boundary");
// 2026-03-08 02:30 does not exist in America/Chicago (spring forward). Luxon
// silently pushes it to 03:30, so the importer must FLAG it rather than import
// a booking an hour away from what the operator's export said.
const gap = parseLocalDateTimeDetailed("2026-03-08", "02:30", TZ);
eq("spring-forward gap still yields an instant", gap.instant instanceof Date, true);
eq("spring-forward gap is FLAGGED as shifted", gap.dstShifted, true);
eq(
  "a normal time is not flagged",
  parseLocalDateTimeDetailed("2026-09-03", "07:00", TZ).dstShifted,
  false,
);
eq(
  "fall-back ambiguity is not flagged (the time does exist)",
  parseLocalDateTimeDetailed("2026-11-01", "01:30", TZ).dstShifted,
  false,
);
// 2026-11-01 01:30 happens twice (fall back); luxon picks the first.
const ambiguous = parseLocalDateTime("2026-11-01", "01:30", TZ);
eq("fall-back ambiguity resolves", ambiguous instanceof Date, true);
eq(
  "fall-back picks the earlier (CDT) instant",
  ambiguous ? DateTime.fromJSDate(ambiguous, { zone: TZ }).offset : null,
  -300,
);

console.log("\nnormalizePhone");
eq("10 digit", normalizePhone("(214) 555-0134"), "+12145550134");
eq("11 digit leading 1", normalizePhone("1-214-555-0134"), "+12145550134");
eq("already e164", normalizePhone("+12145550134"), "+12145550134");
eq("too short → null", normalizePhone("555-0134"), null);
eq("blank → null", normalizePhone(""), null);

console.log("\nsplitName");
eq("first last", splitName("John Smith"), { firstName: "John", lastName: "Smith" });
eq("comma order", splitName("Smith, John"), { firstName: "John", lastName: "Smith" });
eq("single token", splitName("Cher"), { firstName: "Cher", lastName: null });
eq("middle name", splitName("John Q Public"), { firstName: "John Q", lastName: "Public" });
eq("blank", splitName("  "), { firstName: null, lastName: null });

console.log("\nsyntheticEmail");
eq("per-ref uniqueness", syntheticEmail("AB12CD"), "fh-ab12cd@import.invalid");
eq("distinct per booking", syntheticEmail("A1") !== syntheticEmail("A2"), true);

console.log("\nlooksCancelled");
eq("cancelled", looksCancelled("Cancelled"), true);
eq("canceled us spelling", looksCancelled("canceled"), true);
eq("normal", looksCancelled("Confirmed"), false);
eq("blank", looksCancelled(""), false);

console.log("\nsuggestMapping");
const m = suggestMapping([
  "Booking ID", "Item", "Availability Start Date", "Availability Start Time",
  "Contact Name", "Contact Email", "Contact Phone", "Customer Type",
  "Quantity", "Total", "Status", "Notes",
]);
eq("externalRef", m.externalRef, "Booking ID");
eq("itemName", m.itemName, "Item");
eq("startDate", m.startDate, "Availability Start Date");
eq("startTime", m.startTime, "Availability Start Time");
eq("customerEmail", m.customerEmail, "Contact Email");
eq("riderTypeName", m.riderTypeName, "Customer Type");
eq("totalCents", m.totalCents, "Total");
eq("no header claimed twice", new Set(Object.values(m)).size, Object.values(m).length);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

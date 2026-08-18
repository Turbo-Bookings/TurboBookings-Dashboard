/**
 * Arm 24h/2h reminder emails for bookings that were IMPORTED from a previous
 * booking system (external_ref set), which the importer deliberately skipped.
 *
 * Mirrors sendBookingLifecycleEmails(..., { confirmation:false, reminders:true,
 * review:false }) exactly -- same idempotency keys, so if that code path ever
 * runs for these bookings the unique index makes it a no-op instead of a
 * duplicate send. Confirmation and post-tour review stay OFF by design: these
 * guests already got the old system's confirmation and never booked through us.
 *
 * Only arms sends still in the future, only for active bookings, and never for
 * synthesized `@import.invalid` addresses (guaranteed hard bounce).
 *
 * Usage:
 *   node --env-file-if-exists=.env.local --import tsx \
 *     scripts/backfill-import-reminders.ts <slug> [--commit]
 */
import { sql } from "drizzle-orm";
import { withTxn } from "../src/lib/db/pool";

const slug = process.argv[2];
const commit = process.argv.includes("--commit");
if (!slug) { console.error("usage: backfill-import-reminders.ts <slug> [--commit]"); process.exit(1); }

const FROM = (lead: string) => `
  from bookings b
  join locations l on l.id = b.location_id
  join availabilities a on a.id = b.availability_id
  join customers c on c.id = b.customer_id
  where l.slug = '${slug}'
    and b.external_ref is not null
    and b.status = 'active'
    and c.email_lower is not null
    and c.email_lower not like '%@import.invalid'
    and a.starts_at > now() + interval '${lead}'
`;

const INSERT = (type: string, lead: string) => `
  insert into scheduled_emails
    (type, location_id, booking_id, recipient_email, scheduled_at, next_attempt_at, idempotency_key)
  select '${type}'::scheduled_email_type, b.location_id, b.id, c.email_lower,
         a.starts_at - interval '${lead}', a.starts_at - interval '${lead}',
         '${type}:' || b.id
  ${FROM(lead)}
  on conflict (idempotency_key) do nothing
  returning id`;

async function main() {
  await withTxn(async (tx) => {
    for (const [type, lead] of [["reminder_24h", "24 hours"], ["reminder_2h", "2 hours"]] as const) {
      const pre: any = await tx.execute(sql.raw(`select count(*)::int as n ${FROM(lead)}`));
      console.log(`${type}: ${(pre.rows ?? pre)[0].n} eligible booking(s)`);
    }
    if (!commit) { console.log("\nDRY RUN — pass --commit to arm.\n"); return; }
    let total = 0;
    for (const [type, lead] of [["reminder_24h", "24 hours"], ["reminder_2h", "2 hours"]] as const) {
      const r: any = await tx.execute(sql.raw(INSERT(type, lead)));
      const n = (r.rows ?? r).length;
      total += n;
      console.log(`  armed ${n} × ${type}`);
    }
    const chk: any = await tx.execute(sql.raw(`
      select type::text as type, count(*) as pending, min(scheduled_at) as next_send
      from scheduled_emails se
      join bookings b on b.id = se.booking_id
      join locations l on l.id = b.location_id
      where l.slug='${slug}' and se.sent_at is null and se.canceled_at is null
      group by 1 order by 1`));
    console.log(`\nTotal armed: ${total}`);
    console.table(chk.rows ?? chk);
  });
}
main().then(() => process.exit(0)).catch((e) => { console.error(e.cause?.message ?? e.message); process.exit(1); });

/**
 * Read-only health check for the scheduled-email pipeline.
 *
 * Answers "are reminders actually going out?" — which cannot be assumed, because
 * every failure mode in this path is silent: emailConfigured() returning false
 * skips sends with no error, and a stalled cron just leaves rows pending.
 *
 * Usage:
 *   npm run emails:status -- <slug>
 */
import { sql } from "drizzle-orm";
import { withTxn } from "../src/lib/db/pool";

const slug = process.argv[2];
if (!slug) {
  console.error("usage: npm run emails:status -- <slug>");
  process.exit(1);
}

async function main() {
  await withTxn(async (tx) => {
    const scoped = `
      from scheduled_emails se
      join bookings b on b.id = se.booking_id
      join locations l on l.id = b.location_id
      where l.slug = '${slug}'`;

    const summary: any = await tx.execute(
      sql.raw(`
        select se.type::text as type,
               count(*) filter (where se.sent_at is not null) as sent,
               count(*) filter (where se.sent_at is null and se.canceled_at is null) as pending,
               count(*) filter (where se.canceled_at is not null) as canceled,
               count(*) filter (where se.last_error is not null) as errored,
               max(se.attempt_count) as max_attempts
        ${scoped}
        group by 1 order by 1`),
    );
    console.log(`\n=== ${slug}: scheduled_emails by type ===`);
    console.table(summary.rows ?? summary);

    const due: any = await tx.execute(
      sql.raw(`
        select count(*) as overdue_unsent, min(se.scheduled_at) as oldest_due
        ${scoped}
          and se.sent_at is null and se.canceled_at is null
          and se.scheduled_at < now()`),
    );
    console.log("=== Past their send time but still unsent (should be ~0) ===");
    console.table(due.rows ?? due);

    const errs: any = await tx.execute(
      sql.raw(`
        select se.type::text as type, se.attempt_count, se.recipient_email,
               left(se.last_error, 90) as last_error
        ${scoped} and se.last_error is not null
        order by se.attempt_count desc limit 10`),
    );
    const errRows = errs.rows ?? errs;
    console.log(`=== Errors (${errRows.length}) ===`);
    if (errRows.length) console.table(errRows);
    else console.log("none\n");

    const recent: any = await tx.execute(
      sql.raw(`
        select se.type::text as type, se.sent_at, se.resend_email_id
        ${scoped} and se.sent_at is not null
        order by se.sent_at desc limit 5`),
    );
    const recentRows = recent.rows ?? recent;
    console.log(`=== Most recent sends (${recentRows.length}) ===`);
    if (recentRows.length) {
      console.table(recentRows);
      console.log("A populated resend_email_id means Resend accepted it.\n");
    } else {
      console.log(
        "NONE SENT YET. If any rows are past due above, the pipeline is not\n" +
          "running — check the /api/cron/scheduled-emails cron, CRON_SECRET, and\n" +
          "that RESEND_API_KEY + EMAIL_FROM_ADDRESS are set on the BOOKINGSYSTEM\n" +
          "project (emailConfigured() skips silently when either is missing).\n",
      );
    }
  });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e.cause?.message ?? e.message);
    process.exit(1);
  });

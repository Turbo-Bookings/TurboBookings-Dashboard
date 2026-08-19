/**
 * Read-only health check for operator booking-alert push notifications.
 *
 * Same reason status-emails.ts exists: every failure in this path is silent.
 * A revoked endpoint, a cron that stopped firing, or a subscription that was
 * never saved all look identical from the dashboard — nothing happens, and
 * nobody finds out until a booking is missed.
 *
 * Usage:
 *   npm run push:status -- <slug>
 */
import { sql } from "drizzle-orm";
import { withTxn } from "../src/lib/db/pool";

const slug = process.argv[2];
if (!slug) {
  console.error("usage: npm run push:status -- <slug>");
  process.exit(1);
}

async function main() {
  const configured = Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY,
  );
  console.log(`\nVAPID configured locally: ${configured ? "yes" : "NO — sends are skipped"}`);

  await withTxn(async (tx) => {
    const subs: any = await tx.execute(
      sql.raw(`
        select ps.user_id,
               left(ps.endpoint, 42) || '…' as endpoint,
               coalesce(ps.user_agent, '') as device,
               ps.failure_count,
               ps.last_success_at,
               ps.created_at
        from push_subscriptions ps
        join locations l on l.id = ps.location_id
        where l.slug = '${slug}'
        order by ps.created_at desc`),
    );
    const rows = subs.rows ?? subs;
    console.log(`\n=== ${slug}: subscribed devices (${rows.length}) ===`);
    if (rows.length === 0) {
      console.log("  none — nobody has turned on alerts at this location yet.");
    } else {
      console.table(
        rows.map((r: any) => ({
          user: r.user_id.slice(0, 12) + "…",
          device: String(r.device).slice(0, 40),
          fails: r.failure_count,
          lastOk: r.last_success_at ?? "never",
        })),
      );
    }

    // The two numbers that show whether the cron is actually running: anything
    // sitting unalerted INSIDE the window means the last tick has not happened
    // yet (or is failing); a healthy system keeps that at 0 most of the time.
    const cron: any = await tx.execute(
      sql.raw(`
        select
          count(*) filter (where b.alerted_at is not null) as alerted_total,
          count(*) filter (
            where b.alerted_at is null and b.status = 'active'
              and b.created_at > (now() at time zone 'utc') - interval '20 minutes'
          ) as pending_in_window,
          max(b.alerted_at) as last_alert_at
        from bookings b
        join locations l on l.id = b.location_id
        where l.slug = '${slug}'`),
    );
    console.log(`\n=== ${slug}: alert cron ===`);
    console.table(cron.rows ?? cron);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

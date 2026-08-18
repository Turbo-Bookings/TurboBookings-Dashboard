/**
 * Read-only health check for a location's retainer subscription.
 *
 * The failure this guards against is a FALSE ACTIVE: the dashboard's Stripe
 * webhook updates retainer_status by matching stripe_subscription_id, so if the
 * stored ID does not correspond to a real LIVE subscription, status can never
 * change — a failed payment keeps displaying "active" forever.
 *
 * Flags the two states that look fine but are not:
 *   - status active with no subscription ID at all
 *   - a subscription ID that never changed after a test -> live cutover
 *
 * Usage:
 *   npm run retainer:status -- <slug>
 */
import { sql } from "drizzle-orm";
import { withTxn } from "../src/lib/db/pool";

const slug = process.argv[2];
if (!slug) {
  console.error("usage: npm run retainer:status -- <slug>");
  process.exit(1);
}

async function main() {
  await withTxn(async (tx) => {
    const r: any = await tx.execute(
      sql.raw(`
        select slug, retainer_status::text as status,
               retainer_cents, retainer_billing_day,
               coalesce(stripe_subscription_id, '(none)') as sub,
               coalesce(stripe_platform_customer_id, '(none)') as cust,
               coalesce(retainer_card_brand, '(none)') as card,
               coalesce(retainer_card_last4, '(none)') as last4,
               updated_at
        from locations where slug = '${slug}'`),
    );
    const row = (r.rows ?? r)[0];
    if (!row) {
      console.error(`No location '${slug}'`);
      process.exit(1);
    }
    console.log(`\n=== ${slug}: retainer ===`);
    console.table([row]);

    const problems: string[] = [];
    if (row.status === "active" && row.sub === "(none)") {
      problems.push(
        "status=active but NO subscription id — the webhook has nothing to match on, " +
          "so this status can never update. Classic false-active.",
      );
    }
    if (row.sub !== "(none)" && row.cust === "(none)") {
      problems.push(
        "subscription id present but no platform customer id — inconsistent; " +
          "startSubscription() would refuse with 'No card on file'.",
      );
    }
    if (row.last4 === "4242") {
      problems.push(
        "card on file is 4242 — that is Stripe's TEST card. It does not exist in " +
          "live mode; run `npm run retainer:reset -- " + slug + " --commit`.",
      );
    }
    if (row.cust !== "(none)" && row.last4 === "(none)" && row.sub === "(none)") {
      problems.push(
        "platform customer exists but NO card is saved — the card form was opened " +
          "(ensurePlatformCustomer runs on SetupIntent creation) and not completed.\n" +
          "    DO NOT press Start retainer yet. startSubscription() guards on the " +
          "CUSTOMER id, not the card, so it will happily create a subscription with " +
          "no payment method; it sits in `trialing` (which maps to active) and only " +
          "fails on the billing day. Finish saving the card first — done when " +
          "retainer_card_last4 is populated.",
      );
    }
    if (row.status === "inactive" && row.sub === "(none)") {
      console.log(
        "State: cleanly reset, awaiting live card + Start retainer.\n" +
          "Order matters — add the card FIRST (creates the live customer), then Start.\n",
      );
    }

    if (problems.length) {
      console.log("PROBLEMS:");
      for (const p of problems) console.log(`  - ${p}`);
      console.log();
    } else if (row.sub !== "(none)") {
      console.log(
        `Looks healthy. Confirm in the Stripe LIVE dashboard that destination\n` +
          `dashboard-retainer-subscriptions has delivered events for ${row.sub}.\n` +
          `Zero deliveries means a future failed payment will still read active.\n`,
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

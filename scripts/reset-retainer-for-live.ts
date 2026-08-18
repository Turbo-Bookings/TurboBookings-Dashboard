/**
 * Reset a location's retainer + stored-card state after switching Stripe from
 * TEST mode to LIVE mode.
 *
 * Why this is needed: Stripe test and live mode are separate universes. A
 * retainer set up in test mode leaves `stripe_subscription_id` /
 * `stripe_platform_customer_id` pointing at objects that do not exist in live
 * mode. Two consequences, both bad:
 *
 *  1. `retainer_status` freezes. The webhook updates by matching
 *     `stripe_subscription_id` (see the dashboard's api/webhooks/stripe
 *     `setStatusBySubscription`). Live events carry live IDs, which never match
 *     the stored test ID, so the UPDATE hits zero rows -- forever. The dashboard
 *     keeps showing a healthy retainer for a subscription billing nobody.
 *  2. `startRetainer()` refuses to run: it bails with "A retainer subscription
 *     is already running" whenever `stripeSubscriptionId` is set and the status
 *     is not `canceled`. So the stale row actively blocks the live setup.
 *
 * Clears the Stripe object references and the cached card display fields, and
 * removes guest cards on file that are Stripe test cards (last4 = 4242) -- those
 * payment methods do not exist in live mode, so a check-in charge against them
 * would fail.
 *
 * Deliberately PRESERVED: `retainer_cents` and `retainer_billing_day`. Those are
 * business config (e.g. $3,250 on day 15), not Stripe objects, and re-entering
 * them by hand is exactly the kind of step that gets fumbled at go-live.
 *
 * Usage:
 *   node --env-file-if-exists=.env.local --import tsx \
 *     scripts/reset-retainer-for-live.ts <slug> [--commit]
 */
import { sql } from "drizzle-orm";
import { withTxn } from "../src/lib/db/pool";

const slug = process.argv[2];
const commit = process.argv.includes("--commit");
if (!slug) {
  console.error("usage: reset-retainer-for-live.ts <slug> [--commit]");
  process.exit(1);
}

async function main() {
  await withTxn(async (tx) => {
    const before: any = await tx.execute(
      sql.raw(`
        select slug, retainer_status::text as status, retainer_cents,
               retainer_billing_day,
               coalesce(stripe_subscription_id, '(none)') as sub,
               coalesce(stripe_platform_customer_id, '(none)') as cust,
               coalesce(retainer_card_brand, '(none)') as card_brand,
               coalesce(retainer_card_last4, '(none)') as card_last4
        from locations where slug = '${slug}'`),
    );
    console.log("\nBEFORE:");
    console.table(before.rows ?? before);

    const cards: any = await tx.execute(
      sql.raw(`
        select pm.stripe_payment_method_id, pm.brand, pm.last4
        from payment_methods_on_file pm
        join customers c on c.id = pm.customer_id
        join locations l on l.id = c.location_id
        where l.slug = '${slug}' and pm.last4 = '4242'`),
    );
    console.log(`Stripe test cards (4242) on file: ${(cards.rows ?? cards).length}`);

    if (!commit) {
      console.log("\nDRY RUN -- pass --commit to apply.\n");
      return;
    }

    const updated: any = await tx.execute(
      sql.raw(`
        update locations
           set stripe_subscription_id = null,
               stripe_platform_customer_id = null,
               retainer_status = 'inactive',
               retainer_card_brand = null,
               retainer_card_last4 = null,
               updated_at = now()
         where slug = '${slug}'
        returning slug, retainer_status::text as status,
                  retainer_cents, retainer_billing_day`),
    );

    const removed: any = await tx.execute(
      sql.raw(`
        delete from payment_methods_on_file
         where id in (
           select pm.id from payment_methods_on_file pm
           join customers c on c.id = pm.customer_id
           join locations l on l.id = c.location_id
           where l.slug = '${slug}' and pm.last4 = '4242')
        returning stripe_payment_method_id`),
    );

    console.log("\nAFTER (billing config preserved):");
    console.table(updated.rows ?? updated);
    console.log(`Removed ${(removed.rows ?? removed).length} test card(s) on file.`);
    console.log(
      "\nNext: re-add the retainer card in LIVE mode via Settings -> Billing, " +
        "then Start retainer. That writes fresh live sub/customer IDs and the " +
        "webhook starts tracking status again.\n",
    );
  });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e.cause?.message ?? e.message);
    process.exit(1);
  });

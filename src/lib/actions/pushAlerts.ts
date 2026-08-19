"use server";

import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { getDb, pushSubscriptions } from "@/lib/db";
import { getLocationBySlug } from "@/lib/data/locations";
import { can } from "@/lib/auth/roles";
import { sendToUserAtLocation, type SendResult } from "@/lib/push/send";

// New-booking push alerts.
//
// Who may subscribe: global roles (master / admin) plus operator and director at
// the location. Deliberately NOT basic_user — check-in staff do not need a buzz
// every time a sale lands, and the fastest way to get a notification channel
// muted is to send it to people who cannot act on it.
//
// The role check happens HERE, once, rather than at send time. The alternative
// would mean reading Clerk for every subscriber on every cron tick; instead the
// subscription row itself is the record of "this person was entitled when they
// asked", and revoking access removes it via the unsubscribe path or the row
// simply stops mattering when the location is deleted (FK cascade).
//
// manage_bookings is exactly the intended set: director and above at the
// location, and a global master/admin at every location (getRoleForLocation
// short-circuits on the global role). basic_user only holds `checkin`, so
// front-line staff are excluded without needing a special case.
async function mayReceiveAlerts(slug: string): Promise<boolean> {
  return can("manage_bookings", slug);
}

export type SubscribeResult = { ok: true } | { ok: false; error: string };

export async function savePushSubscription(
  slug: string,
  sub: { endpoint: string; p256dh: string; auth: string },
  userAgent?: string,
): Promise<SubscribeResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Not signed in" };
  if (!(await mayReceiveAlerts(slug)))
    return { ok: false, error: "You don't have permission to receive booking alerts here." };

  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };
  if (!sub.endpoint || !sub.p256dh || !sub.auth)
    return { ok: false, error: "Incomplete push subscription" };

  const db = getDb();
  // Upsert on (endpoint, location): re-subscribing on the same device must not
  // create duplicates, and it should clear any accumulated failure count so a
  // device that was pruned for being unreachable starts clean.
  await db
    .insert(pushSubscriptions)
    .values({
      userId,
      locationId: location.id,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
      userAgent: userAgent?.slice(0, 400) ?? null,
    })
    .onConflictDoUpdate({
      target: [pushSubscriptions.endpoint, pushSubscriptions.locationId],
      set: {
        userId,
        p256dh: sub.p256dh,
        auth: sub.auth,
        userAgent: userAgent?.slice(0, 400) ?? null,
        failureCount: 0,
      },
    });
  return { ok: true };
}

export async function deletePushSubscription(
  slug: string,
  endpoint: string,
): Promise<SubscribeResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Not signed in" };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };

  const db = getDb();
  // No capability check on removal on purpose: someone must always be able to
  // turn alerts off on their own device, including after losing access.
  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.endpoint, endpoint),
        eq(pushSubscriptions.locationId, location.id),
        eq(pushSubscriptions.userId, userId),
      ),
    );
  return { ok: true };
}

/** Whether THIS device is already subscribed, so the toggle renders correctly. */
export async function isPushSubscribed(
  slug: string,
  endpoint: string,
): Promise<boolean> {
  const { userId } = await auth();
  if (!userId) return false;
  const location = await getLocationBySlug(slug);
  if (!location) return false;
  const rows = await getDb()
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.endpoint, endpoint),
        eq(pushSubscriptions.locationId, location.id),
        eq(pushSubscriptions.userId, userId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Fire a notification at the caller's own devices at this location.
 *
 * Worth its own action: web push has a long chain (permission → service worker
 * → push service → OS) and every link fails silently. Without a way to prove it
 * end-to-end, the first time anyone learns alerts are broken is the booking
 * they missed.
 */
export async function sendTestPush(slug: string): Promise<SendResult> {
  const { userId } = await auth();
  if (!userId) return { sent: 0, pruned: 0, failed: 0 };
  if (!(await mayReceiveAlerts(slug))) return { sent: 0, pruned: 0, failed: 0 };
  const location = await getLocationBySlug(slug);
  if (!location) return { sent: 0, pruned: 0, failed: 0 };

  return sendToUserAtLocation(userId, location.id, {
    title: "Test alert",
    body: "Booking alerts are working on this device.",
    url: `/locations/${slug}/dashboard`,
    tag: "test-alert",
  });
}

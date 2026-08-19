import "server-only";
import webpush, { WebPushError } from "web-push";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, pushSubscriptions } from "@/lib/db";

// Web-push delivery for operator booking alerts.
//
// The only sender in the app. Everything that wants to notify an operator goes
// through here, so endpoint pruning and the VAPID configuration live in exactly
// one place.

let configured = false;

/** True when VAPID is configured; callers no-op rather than throw without it. */
export function pushConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY,
  );
}

function configure(): void {
  if (configured) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:sel@takeoversrentals.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  configured = true;
}

export type PushPayload = {
  title: string;
  body: string;
  /** Deep link opened on tap. Relative to the dashboard origin. */
  url: string;
  /** Collapse key — repeat sends for the same booking replace, not stack. */
  tag?: string;
};

export type SendResult = {
  sent: number;
  /** Endpoints deleted because the push service said they no longer exist. */
  pruned: number;
  failed: number;
};

// Push services drop undelivered messages after the TTL. A booking alert is
// worthless an hour later — the operator will have seen it in the dashboard by
// then — so it expires rather than arriving stale.
const SEND_OPTS = { TTL: 3600, urgency: "high" } as const;

type SubRow = typeof pushSubscriptions.$inferSelect;

/**
 * Deliver to a set of subscription rows, pruning the ones the push service says
 * are gone.
 *
 * Failure handling is deliberately asymmetric. A 404/410 means the browser
 * revoked the subscription — it will never work again, so the row is deleted
 * immediately rather than retried forever. Anything else (a 500 from the push
 * service, a network blip) increments failure_count and leaves the row: those
 * are usually transient, and deleting on one bad night would silently
 * unsubscribe an operator who never asked to be unsubscribed.
 */
async function deliver(subs: SubRow[], payload: PushPayload): Promise<SendResult> {
  if (subs.length === 0) return { sent: 0, pruned: 0, failed: 0 };
  const db = getDb();
  const body = JSON.stringify(payload);
  const ok: string[] = [];
  const dead: string[] = [];
  const soft: string[] = [];

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          SEND_OPTS,
        );
        ok.push(s.id);
      } catch (err) {
        const gone =
          err instanceof WebPushError &&
          (err.statusCode === 404 || err.statusCode === 410);
        (gone ? dead : soft).push(s.id);
      }
    }),
  );

  if (ok.length > 0)
    await db
      .update(pushSubscriptions)
      .set({ lastSuccessAt: new Date(), failureCount: 0 })
      .where(inArray(pushSubscriptions.id, ok));

  if (dead.length > 0)
    await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, dead));

  if (soft.length > 0)
    await db
      .update(pushSubscriptions)
      .set({ failureCount: sql`${pushSubscriptions.failureCount} + 1` })
      .where(inArray(pushSubscriptions.id, soft));

  return { sent: ok.length, pruned: dead.length, failed: soft.length };
}

/** Deliver a payload to every device subscribed at a location. */
export async function sendToLocation(
  locationId: string,
  payload: PushPayload,
): Promise<SendResult> {
  if (!pushConfigured()) return { sent: 0, pruned: 0, failed: 0 };
  configure();
  const subs = await getDb()
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.locationId, locationId));
  return deliver(subs, payload);
}

/** Used by the "send a test" button, so an operator can prove alerts work. */
export async function sendToUserAtLocation(
  userId: string,
  locationId: string,
  payload: PushPayload,
): Promise<SendResult> {
  if (!pushConfigured()) return { sent: 0, pruned: 0, failed: 0 };
  configure();
  const subs = await getDb()
    .select()
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.userId, userId),
        eq(pushSubscriptions.locationId, locationId),
      ),
    );
  return deliver(subs, payload);
}

import { createHmac } from "node:crypto";

import { and, asc, isNull, lte, sql } from "drizzle-orm";

import { getDb, outboundEventQueue } from "@/lib/db";
import type { Envelope } from "@/lib/events/emit";

// Cron-driven worker that drains outbound_event_queue. Spec'd in
// VERCEL_PREP_FOR_REPLIT_INTEGRATION.md §4.2. Scheduled every minute via
// vercel.json. emit.ts writes here on initial send failure; this route
// retries with exponential backoff and dead-letters after 6 attempts.

const BATCH_SIZE = 50;

// Backoff schedule (ms) indexed by attempt_count BEFORE the current attempt.
// attempt_count=0 → wait 60s before first retry (already set at enqueue time)
// attempt_count=1 → wait 5min
// attempt_count=2 → wait 30min
// attempt_count=3 → wait 6h
// attempt_count=4 → wait 6h
// attempt_count=5 → next attempt → if it fails, dead-letter
const BACKOFF_MS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  6 * 60 * 60_000,
  6 * 60 * 60_000,
  6 * 60 * 60_000,
];
const MAX_ATTEMPTS = 6;

function authorized(req: Request): boolean {
  // Vercel cron sends Authorization: Bearer <CRON_SECRET> when the env var
  // is set. Allow either bearer-token format the Vercel docs show.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // No secret configured — accept all in dev. Cron in production should
    // always have CRON_SECRET set.
    return process.env.NODE_ENV !== "production";
  }
  const header = req.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

type QueueRow = typeof outboundEventQueue.$inferSelect;

async function attemptDelivery(
  row: QueueRow,
  url: string,
  secret: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const envelope = row.envelope as unknown as Envelope;
  const body = JSON.stringify(envelope);
  const signature = createHmac("sha256", secret).update(body).digest("hex");

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Turbobookings-Signature": `sha256=${signature}`,
        "X-Turbobookings-Tenant": envelope.tenant_id,
        "X-Turbobookings-Event-Id": envelope.event_id,
      },
      body,
    });
    if (response.ok) return { ok: true };
    return { ok: false, error: `HTTP ${response.status} ${response.statusText}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = process.env.REPLIT_WEBHOOK_URL;
  const secret = process.env.REPLIT_WEBHOOK_SECRET;
  if (!url || !secret) {
    return Response.json({
      ok: true,
      skipped: true,
      reason: "REPLIT_WEBHOOK_URL or REPLIT_WEBHOOK_SECRET not set",
    });
  }

  const db = getDb();
  const due = await db
    .select()
    .from(outboundEventQueue)
    .where(
      and(
        isNull(outboundEventQueue.succeededAt),
        lte(outboundEventQueue.nextAttemptAt, new Date()),
        sql`${outboundEventQueue.attemptCount} < ${MAX_ATTEMPTS}`,
      ),
    )
    .orderBy(asc(outboundEventQueue.nextAttemptAt))
    .limit(BATCH_SIZE);

  let succeeded = 0;
  let failed = 0;
  let deadLettered = 0;

  for (const row of due) {
    const result = await attemptDelivery(row, url, secret);
    const newAttemptCount = row.attemptCount + 1;

    if (result.ok) {
      await db
        .update(outboundEventQueue)
        .set({
          succeededAt: new Date(),
          attemptCount: newAttemptCount,
          lastError: null,
        })
        .where(sql`${outboundEventQueue.id} = ${row.id}`);
      succeeded += 1;
      continue;
    }

    if (newAttemptCount >= MAX_ATTEMPTS) {
      // Dead-letter: leave succeeded_at NULL, attempt_count at max, schedule
      // far in the future so future cron runs skip it.
      const farFuture = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365 * 100);
      await db
        .update(outboundEventQueue)
        .set({
          attemptCount: newAttemptCount,
          lastError: result.error,
          nextAttemptAt: farFuture,
        })
        .where(sql`${outboundEventQueue.id} = ${row.id}`);
      deadLettered += 1;
      continue;
    }

    const backoff = BACKOFF_MS[newAttemptCount] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
    await db
      .update(outboundEventQueue)
      .set({
        attemptCount: newAttemptCount,
        lastError: result.error,
        nextAttemptAt: new Date(Date.now() + backoff),
      })
      .where(sql`${outboundEventQueue.id} = ${row.id}`);
    failed += 1;
  }

  return Response.json({
    ok: true,
    processed: due.length,
    succeeded,
    failed,
    deadLettered,
  });
}

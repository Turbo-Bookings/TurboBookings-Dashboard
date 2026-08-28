import { createHmac, randomUUID } from "node:crypto";

import { getDb, outboundEventQueue } from "@/lib/db";

// Cross-system event channel: Vercel → the Railway brain. Implements the contract in
// docs/cross-system/CROSS_SYSTEM_EVENT_CONTRACT.md. Same shape in both
// dashboard and bookingsystem repos; both write to the shared
// outbound_event_queue when delivery fails. The retry cron lives in the
// dashboard at /api/cron/retry-events.

export type SourceSurface = "marketing_site" | "booking_system" | "dashboard";

export type Envelope = {
  event_id: string;
  event_type: string;
  event_version: string;
  occurred_at: string;
  tenant_id: string;
  location_id: string;
  source_surface: SourceSurface;
  data: Record<string, unknown>;
};

export type EmitInput = {
  event_type: string;
  tenant_id?: string;
  location_id: string;
  source_surface: SourceSurface;
  data: Record<string, unknown>;
  occurred_at?: string;
  /**
   * Whether a failed send should go on `outbound_event_queue` for the retry cron. Default true.
   *
   * Set false for events that SUPERSEDE rather than accumulate — currently `inventory.snapshot`.
   * Queueing those is actively harmful in two ways:
   *
   *   1. The backoff runs out to ~13h, so a snapshot that fails at 09:00 can be delivered at 22:00
   *      and overwrite the 21:00 one. `event_id` dedup cannot help: every snapshot has a fresh id.
   *   2. The drain is a shared 50-per-minute budget. A receiver outage would fill the queue with
   *      dead snapshots queued AHEAD of `booking.created`, so the inventory feed would delay revenue
   *      truth — the one number the whole spend objective is measured against.
   *
   * Dropping is correct for a superseding event: the next tick replaces it within the hour, and the
   * gap is visible to the receiver as staleness rather than as a wrong number.
   */
  queue_on_failure?: boolean;
};

export const EVENT_VERSION = "1.0";

const FIRST_BACKOFF_MS = 60_000; // 1 minute — matches cron cadence

function getTenantId(): string {
  const id = process.env.TURBOBOOKINGS_TENANT_ID;
  if (!id) {
    throw new Error(
      "TURBOBOOKINGS_TENANT_ID is not set. Generate one with `uuidgen` and set on Vercel.",
    );
  }
  return id;
}

// The event target is the Railway "brain" — today the ad cockpit's
// /api/webhooks/turbobookings. Prefer BRAIN_WEBHOOK_*; fall back to the legacy
// REPLIT_* names until they are deleted. Same HMAC contract either way.
//
// The REPLIT_ prefix is a fossil and NOTHING is ever sent from Replit: this is
// the key OUR storefront SIGNS outbound events with. It was named after the
// receiver that was planned at the time and never built. This file used to read
// the legacy names ONLY, while bookingsystem read BRAIN_ first — and since the
// retry cron lives in THIS repo, setting only BRAIN_WEBHOOK_URL left the cron
// and every dashboard-sourced event silently dark.
function getBrainWebhookSecret(_tenantId: string): string | null {
  // V1: single tenant — env var. V2 (white-label) will look up per-tenant
  // from the location_secrets table.
  return (
    process.env.BRAIN_WEBHOOK_SECRET ?? process.env.REPLIT_WEBHOOK_SECRET ?? null
  );
}

function getBrainWebhookUrl(): string | null {
  return process.env.BRAIN_WEBHOOK_URL ?? process.env.REPLIT_WEBHOOK_URL ?? null;
}

export async function emitEvent(input: EmitInput): Promise<void> {
  const envelope: Envelope = {
    event_id: randomUUID(),
    event_version: EVENT_VERSION,
    occurred_at: input.occurred_at ?? new Date().toISOString(),
    event_type: input.event_type,
    tenant_id: input.tenant_id ?? getTenantId(),
    location_id: input.location_id,
    source_surface: input.source_surface,
    data: input.data,
  };

  const url = getBrainWebhookUrl();
  const secret = getBrainWebhookSecret(envelope.tenant_id);

  // No receiver configured: queue everything for when one comes online.
  if (!url || !secret) {
    await enqueueForRetry(envelope, "BRAIN_WEBHOOK_URL or _SECRET not set", input.queue_on_failure);
    return;
  }

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
      // Timeboxed. This runs inline after a booking has already been committed — and in the operator
      // flow, after a card has already been charged. A slow or black-holing receiver used to hang the
      // whole server action, leaving the rep on a frozen button with the money taken. Failure here is
      // already non-fatal: the envelope falls through to outbound_event_queue and the cron retries.
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      await enqueueForRetry(
        envelope,
        `HTTP ${response.status} ${response.statusText}`,
        input.queue_on_failure,
      );
    }
  } catch (err) {
    await enqueueForRetry(
      envelope,
      err instanceof Error ? err.message : String(err),
      input.queue_on_failure,
    );
  }
}

async function enqueueForRetry(
  envelope: Envelope,
  lastError: string,
  queueOnFailure: boolean = true,
): Promise<void> {
  if (queueOnFailure === false) {
    // Deliberately dropped, not lost silently — a superseding event replaces itself next tick.
    console.warn("[emit] dropped (supersedes, not queued)", {
      event_id: envelope.event_id,
      event_type: envelope.event_type,
      lastError,
    });
    return;
  }
  try {
    const db = getDb();
    await db.insert(outboundEventQueue).values({
      eventId: envelope.event_id,
      envelope: envelope as unknown as Record<string, unknown>,
      attemptCount: 0,
      nextAttemptAt: new Date(Date.now() + FIRST_BACKOFF_MS),
      lastError,
    });
  } catch (err) {
    // Last-ditch: log and drop. The DB write itself failed — we have no
    // durable place to put this event. Surfacing via console keeps it in
    // Vercel logs for forensic recovery.
    console.error("[emit] enqueueForRetry failed", {
      event_id: envelope.event_id,
      event_type: envelope.event_type,
      lastError,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

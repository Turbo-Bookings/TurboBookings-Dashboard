import { createHmac, randomUUID } from "node:crypto";

import { getDb, outboundEventQueue } from "@/lib/db";

// Cross-system event channel: Vercel → Replit. Implements the contract in
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

function getReplitWebhookSecret(_tenantId: string): string | null {
  // V1: single tenant — env var. V2 (white-label) will look up per-tenant
  // from the location_secrets table.
  return process.env.REPLIT_WEBHOOK_SECRET ?? null;
}

function getReplitWebhookUrl(): string | null {
  return process.env.REPLIT_WEBHOOK_URL ?? null;
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

  const url = getReplitWebhookUrl();
  const secret = getReplitWebhookSecret(envelope.tenant_id);

  // Replit Phase 0 not deployed yet: queue everything for when it comes online.
  if (!url || !secret) {
    await enqueueForRetry(envelope, "REPLIT_WEBHOOK_URL or _SECRET not set");
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
    });

    if (!response.ok) {
      await enqueueForRetry(
        envelope,
        `HTTP ${response.status} ${response.statusText}`,
      );
    }
  } catch (err) {
    await enqueueForRetry(
      envelope,
      err instanceof Error ? err.message : String(err),
    );
  }
}

async function enqueueForRetry(
  envelope: Envelope,
  lastError: string,
): Promise<void> {
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

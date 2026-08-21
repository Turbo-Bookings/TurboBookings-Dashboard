"use server";

import { and, eq } from "drizzle-orm";
import { getDb, locationSecrets, locations } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto/secrets";
import { assertCan } from "@/lib/auth/roles";
import { getTrackingConfigForLocation } from "@/lib/actions/tracking";

/**
 * Test a location's server-side tracking CREDENTIALS end to end.
 *
 * Why this exists: `firePurchaseServerSide` in the booking app fires Meta CAPI
 * and the GA4 Measurement Protocol with `await fetch(...)` and never inspects
 * either response. An expired token, or one issued against a different dataset,
 * fails completely silently — the booking succeeds, the confirmation email
 * sends, and the conversion simply never arrives. Miami's first live booking
 * reached GA4 but not Meta, and there was no way to tell why without a second
 * real booking and a second real refund.
 *
 * Everything here is non-destructive by default:
 *   - Meta token check is a GET on the dataset. Writes nothing.
 *   - GA4 uses /debug/mp/collect, which VALIDATES and discards. Writes nothing.
 *   - The Meta test event is only sent when a testEventCode is supplied, and
 *     that routes it to the Test Events tab instead of live reporting.
 */

export type CheckStatus = "pass" | "fail" | "skipped";

export type TrackingTestResult = {
  label: string;
  status: CheckStatus;
  detail: string;
};

const GRAPH = "https://graph.facebook.com/v19.0";

async function readSecret(locationId: string, key: string): Promise<string | null> {
  const rows = await getDb()
    .select({ v: locationSecrets.encryptedValue })
    .from(locationSecrets)
    .where(and(eq(locationSecrets.locationId, locationId), eq(locationSecrets.key, key)))
    .limit(1);
  if (!rows[0]?.v) return null;
  try {
    return decryptSecret(rows[0].v);
  } catch {
    // Distinguished from "missing" by the caller: a value that is present but
    // undecryptable means ADMIN_ENCRYPTION_KEY rotated without re-encrypting.
    return "";
  }
}

/** Meta's error envelope, when the call fails. */
type MetaError = {
  error?: { message?: string; type?: string; code?: number; error_subcode?: number };
};

export async function testTrackingCredentials(
  slug: string,
  testEventCode?: string,
): Promise<TrackingTestResult[]> {
  await assertCan("manage_platform", slug);

  const loc = (
    await getDb()
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.slug, slug))
      .limit(1)
  )[0];
  if (!loc) return [{ label: "Location", status: "fail", detail: "Not found" }];

  const cfg = await getTrackingConfigForLocation(loc.id);
  const out: TrackingTestResult[] = [];

  // ---- Meta -------------------------------------------------------------
  const pixelId = cfg?.metaPixelId ?? null;
  const metaToken = await readSecret(loc.id, "META_CAPI_TOKEN");

  if (!pixelId) {
    out.push({ label: "Meta pixel ID", status: "skipped", detail: "Not configured" });
  } else if (metaToken === null) {
    out.push({ label: "Meta CAPI token", status: "fail", detail: "No token stored" });
  } else if (metaToken === "") {
    out.push({
      label: "Meta CAPI token",
      status: "fail",
      detail: "Stored but could not be decrypted — ADMIN_ENCRYPTION_KEY may have rotated",
    });
  } else {
    // Read-only: proves the token is live AND scoped to THIS dataset. A token
    // minted against a different pixel is the failure this catches — it looks
    // perfectly valid until you ask it about a dataset it can't see.
    try {
      const res = await fetch(`${GRAPH}/${pixelId}?fields=id,name&access_token=${encodeURIComponent(metaToken)}`, {
        cache: "no-store",
      });
      const body = (await res.json()) as MetaError & { id?: string; name?: string };
      if (res.ok && body.id === pixelId) {
        out.push({
          label: "Meta CAPI token",
          status: "pass",
          detail: `Valid for dataset "${body.name ?? pixelId}"`,
        });
      } else {
        const e = body.error;
        out.push({
          label: "Meta CAPI token",
          status: "fail",
          detail: e
            ? `${e.message ?? "rejected"} (type ${e.type ?? "?"}, code ${e.code ?? "?"}${
                e.error_subcode ? `/${e.error_subcode}` : ""
              })`
            : `HTTP ${res.status}`,
        });
      }
    } catch (err) {
      out.push({
        label: "Meta CAPI token",
        status: "fail",
        detail: `Request failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // Optional: a real Purchase through the real endpoint, quarantined to the
    // Test Events tab. This is what proves the PAYLOAD is accepted, not just
    // the token — the two fail independently.
    if (testEventCode) {
      try {
        const res = await fetch(`${GRAPH}/${pixelId}/events?access_token=${encodeURIComponent(metaToken)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            data: [
              {
                event_name: "Purchase",
                event_time: Math.floor(Date.now() / 1000),
                event_id: `credential-test-${Date.now()}`,
                action_source: "website",
                event_source_url: "https://dashboard.turbobookings.net/",
                user_data: {
                  // Hash of "credential-test@turbobookings.net" is pointless to
                  // precompute here; Meta only needs a well-formed sha256.
                  em: [
                    "9d1b0b0b5f2a4c7f5d9e2a1c8b7f6e5d4c3b2a1908f7e6d5c4b3a2918f7e6d5c",
                  ],
                },
                custom_data: { currency: "USD", value: 1 },
              },
            ],
            test_event_code: testEventCode,
          }),
        });
        const body = (await res.json()) as MetaError & { events_received?: number; fbtrace_id?: string };
        if (res.ok && (body.events_received ?? 0) > 0) {
          out.push({
            label: "Meta test event",
            status: "pass",
            detail: `Accepted — ${body.events_received} event received. Check Events Manager → Test Events.`,
          });
        } else {
          out.push({
            label: "Meta test event",
            status: "fail",
            detail: body.error?.message ?? `HTTP ${res.status}`,
          });
        }
      } catch (err) {
        out.push({
          label: "Meta test event",
          status: "fail",
          detail: `Request failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    } else {
      out.push({
        label: "Meta test event",
        status: "skipped",
        detail: "Add a test event code from Events Manager → Test Events to send one",
      });
    }
  }

  // ---- GA4 --------------------------------------------------------------
  const measurementId = cfg?.ga4MeasurementId ?? null;
  const ga4Secret = await readSecret(loc.id, "GA4_MP_API_SECRET");

  if (!measurementId) {
    out.push({ label: "GA4 measurement ID", status: "skipped", detail: "Not configured" });
  } else if (ga4Secret === null) {
    out.push({ label: "GA4 API secret", status: "fail", detail: "No secret stored" });
  } else if (ga4Secret === "") {
    out.push({
      label: "GA4 API secret",
      status: "fail",
      detail: "Stored but could not be decrypted — ADMIN_ENCRYPTION_KEY may have rotated",
    });
  } else {
    try {
      // /debug/ validates and DISCARDS. Note GA4 returns HTTP 200 with an empty
      // validationMessages array on success — and also 200 on a bad api_secret,
      // so the array is the only signal that matters.
      const res = await fetch(
        `https://www.google-analytics.com/debug/mp/collect?measurement_id=${encodeURIComponent(
          measurementId,
        )}&api_secret=${encodeURIComponent(ga4Secret)}`,
        {
          method: "POST",
          cache: "no-store",
          body: JSON.stringify({
            client_id: "credential.test",
            events: [
              {
                name: "purchase",
                params: {
                  transaction_id: `credential-test-${Date.now()}`,
                  currency: "USD",
                  value: 1,
                  engagement_time_msec: 1,
                },
              },
            ],
          }),
        },
      );
      const body = (await res.json()) as {
        validationMessages?: { description?: string; validationCode?: string }[];
      };
      const msgs = body.validationMessages ?? [];
      if (res.ok && msgs.length === 0) {
        out.push({
          label: "GA4 API secret",
          status: "pass",
          detail: `Payload valid for ${measurementId}`,
        });
      } else {
        out.push({
          label: "GA4 API secret",
          status: "fail",
          detail: msgs.map((m) => m.description ?? m.validationCode).join("; ") || `HTTP ${res.status}`,
        });
      }
    } catch (err) {
      out.push({
        label: "GA4 API secret",
        status: "fail",
        detail: `Request failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return out;
}

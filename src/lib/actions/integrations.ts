"use server";
import { assertCan, denyIfCannot } from "@/lib/auth/roles";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { recordAudit } from "@/lib/audit";
import { encryptSecret } from "@/lib/crypto/secrets";
import { VERCEL_PUSHABLE_SECRET_KINDS } from "@/lib/integrations/catalog";
import { getDb, locationSecrets, locations } from "@/lib/db";
import type { LocationSecret } from "@/lib/db/schema";
import { SECRET_KINDS, type SecretKind } from "@/lib/integrations/catalog";
import { setProjectEnv, vercelTokenConfigured } from "@/lib/vercel/env";

export type SaveSecretState =
  | { ok: true; pushedToVercel: boolean; pushReason?: string }
  | { ok: false; error: string };

export async function setSecret(
  slug: string,
  kind: SecretKind,
  _prev: SaveSecretState | null,
  formData: FormData,
): Promise<SaveSecretState> {
  const deny = await denyIfCannot("manage_platform", slug);
  if (deny) return { ok: false, error: deny };
  const value = String(formData.get("value") ?? "").trim();
  if (!value) return { ok: false, error: "Paste a token to save" };

  const db = getDb();
  const locRows = await db
    .select({ id: locations.id, vercelProjectId: locations.vercelProjectId })
    .from(locations)
    .where(eq(locations.slug, slug))
    .limit(1);
  if (!locRows[0]) return { ok: false, error: "Location not found" };

  const encrypted = encryptSecret(value);

  await db
    .insert(locationSecrets)
    .values({ locationId: locRows[0].id, key: kind, encryptedValue: encrypted })
    .onConflictDoUpdate({
      target: [locationSecrets.locationId, locationSecrets.key],
      set: {
        encryptedValue: encrypted,
        // Clear the synced timestamp until we successfully push the new
        // value below.
        vercelEnvSyncedAt: null,
        updatedAt: sql`now()`,
      },
    });

  // Best-effort push into the location's MARKETING-SITE Vercel project env —
  // but only for secrets that site actually reads (see
  // VERCEL_PUSHABLE_SECRET_KINDS). Everything else stays in location_secrets,
  // which is where our booking system reads from.
  //
  // This used to push unconditionally, and that pushed Houston's
  // GA4_MP_API_SECRET into the marketing site, re-arming a GA4 double-count
  // that feeds Google Ads bidding. Storing a secret must never change the
  // behaviour of a different system.
  let pushedToVercel = false;
  let pushReason: string | undefined;
  const push = VERCEL_PUSHABLE_SECRET_KINDS.includes(kind)
    ? await setProjectEnv(locRows[0].vercelProjectId, kind, value)
    : ({ ok: false, reason: "not_site_consumed" } as const);
  if (push.ok) {
    await db
      .update(locationSecrets)
      .set({ vercelEnvSyncedAt: sql`now()` })
      .where(
        and(
          eq(locationSecrets.locationId, locRows[0].id),
          eq(locationSecrets.key, kind),
        ),
      );
    pushedToVercel = true;
  } else {
    pushReason =
      push.reason === "not_site_consumed"
        ? "Stored for the booking system. Not pushed to the marketing site — it doesn't read this one."
      : push.reason === "not_configured"
        ? "VERCEL_API_TOKEN not configured — secret saved locally only"
        : push.reason === "no_project_id"
          ? "This location has no Vercel project linked yet — secret saved locally only"
          : push.message ?? "Vercel env push failed";
  }

  revalidatePath(`/locations/${slug}/integrations`);
  await recordAudit({
    slug,
    action: "secret.set",
    summary: `Set secret: ${SECRET_KINDS[kind].label}${pushedToVercel ? " · pushed to Vercel" : ""}`,
    payload: { kind, pushedToVercel },
  });
  return { ok: true, pushedToVercel, pushReason };
}

export async function clearSecret(slug: string, kind: SecretKind): Promise<void> {
  await assertCan("manage_platform", slug);
  const db = getDb();
  const locRows = await db
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.slug, slug))
    .limit(1);
  if (!locRows[0]) return;

  await db
    .delete(locationSecrets)
    .where(
      and(
        eq(locationSecrets.locationId, locRows[0].id),
        eq(locationSecrets.key, kind),
      ),
    );

  revalidatePath(`/locations/${slug}/integrations`);
  await recordAudit({
    slug,
    action: "secret.clear",
    summary: `Cleared secret: ${SECRET_KINDS[kind].label}`,
    payload: { kind },
  });
}

// Read helper for the Integrations page. Returns presence + lastSet
// timestamps + Vercel-sync status — never the decrypted value.
export type SecretSummary = {
  kind: SecretKind;
  configured: boolean;
  updatedAt?: Date;
  vercelEnvSyncedAt?: Date;
};

export async function getSecretSummariesForLocation(
  locationId: string,
): Promise<Record<SecretKind, SecretSummary>> {
  const db = getDb();
  const rows = await db
    .select()
    .from(locationSecrets)
    .where(eq(locationSecrets.locationId, locationId));

  const byKey: Record<string, LocationSecret> = {};
  for (const row of rows) byKey[row.key] = row;

  const result = {} as Record<SecretKind, SecretSummary>;
  for (const kind of Object.keys(SECRET_KINDS) as SecretKind[]) {
    const row = byKey[kind];
    result[kind] = row
      ? {
          kind,
          configured: true,
          updatedAt: row.updatedAt,
          vercelEnvSyncedAt: row.vercelEnvSyncedAt ?? undefined,
        }
      : { kind, configured: false };
  }
  return result;
}

export async function vercelApiTokenStatus(): Promise<boolean> {
  return vercelTokenConfigured();
}

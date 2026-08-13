"use server";
import { assertCan, denyIfCannot } from "@/lib/auth/roles";

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { put, del } from "@vercel/blob";
import { revalidatePath } from "next/cache";
import { assets, getDb, locations } from "@/lib/db";
import type { Asset } from "@/lib/db/schema";

// Asset kinds split into "singular" (one per location — uploading replaces
// the existing one) and "multi" (gallery photos, ordered). Server-side
// enforcement of the singular invariant since we don't have a partial
// unique index in the schema.
const SINGULAR_KINDS = new Set(["hero_desktop", "hero_mobile", "og_image"]);

// Per-kind constraints. Hero videos are larger than photos; OG image is
// smaller because Facebook caps at 8MB and we want to be well under.
const KIND_LIMITS: Record<
  Asset["kind"],
  { maxBytes: number; allowedTypes: Set<string>; label: string }
> = {
  hero_desktop: {
    maxBytes: 50 * 1024 * 1024,
    allowedTypes: new Set(["video/mp4", "video/quicktime", "video/webm"]),
    label: "Hero video (desktop)",
  },
  hero_mobile: {
    maxBytes: 50 * 1024 * 1024,
    allowedTypes: new Set(["video/mp4", "video/quicktime", "video/webm"]),
    label: "Hero video (mobile)",
  },
  og_image: {
    maxBytes: 5 * 1024 * 1024,
    allowedTypes: new Set([
      "image/jpeg",
      "image/png",
      "image/webp",
    ]),
    label: "OG image",
  },
  gallery_photo: {
    maxBytes: 10 * 1024 * 1024,
    allowedTypes: new Set([
      "image/jpeg",
      "image/png",
      "image/webp",
    ]),
    label: "Gallery photo",
  },
};

export type UploadAssetState =
  | { ok: true; kind: Asset["kind"] }
  | { ok: false; error: string };

async function getLocationIdBySlug(slug: string): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.slug, slug))
    .limit(1);
  return rows[0]?.id ?? null;
}

// Unified upload handler. Kind is bound by the caller; file comes through
// FormData. For singular kinds we delete any existing row + the existing
// Blob object first. For gallery photos we just append with the next
// sortOrder. Auto-re-encode of hero videos is a planned Phase 1.4 helper —
// not in MVP. UI should hint at the target ffmpeg recipe in the meantime.
export async function uploadAsset(
  slug: string,
  kind: Asset["kind"],
  _prev: UploadAssetState | null,
  formData: FormData,
): Promise<UploadAssetState> {
  const deny = await denyIfCannot("manage_config", slug);
  if (deny) return { ok: false, error: deny };
  const limits = KIND_LIMITS[kind];
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: `Please choose a ${limits.label.toLowerCase()} file` };
  }
  if (!limits.allowedTypes.has(file.type)) {
    return {
      ok: false,
      error: `${limits.label} must be one of: ${[...limits.allowedTypes].join(", ")}`,
    };
  }
  if (file.size > limits.maxBytes) {
    const mb = Math.round(limits.maxBytes / (1024 * 1024));
    return { ok: false, error: `${limits.label} must be ${mb} MB or smaller` };
  }

  const locationId = await getLocationIdBySlug(slug);
  if (!locationId) return { ok: false, error: "Location not found" };

  const db = getDb();

  // Singular kinds: tear down the existing row + its Blob object before
  // inserting the replacement. Avoids orphaned Blob bytes.
  if (SINGULAR_KINDS.has(kind)) {
    const existing = await db
      .select()
      .from(assets)
      .where(and(eq(assets.locationId, locationId), eq(assets.kind, kind)));
    for (const row of existing) {
      try {
        await del(row.blobUrl);
      } catch (err) {
        console.error("blob delete failed", err);
      }
    }
    if (existing.length > 0) {
      await db
        .delete(assets)
        .where(
          inArray(
            assets.id,
            existing.map((e) => e.id),
          ),
        );
    }
  }

  // Path: kinds/<slug>/<kind>/<timestamp>.<ext> — easy to inspect in Blob
  // browser; doesn't collide across reuploads.
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
  const pathname = `${slug}/${kind}/${Date.now()}.${ext}`;

  const blob = await put(pathname, file, {
    access: "public",
    contentType: file.type,
  });

  // For gallery photos, append at the end of the sort order.
  let sortOrder = 0;
  if (kind === "gallery_photo") {
    const maxRow = await db
      .select({ sortOrder: assets.sortOrder })
      .from(assets)
      .where(and(eq(assets.locationId, locationId), eq(assets.kind, "gallery_photo")))
      .orderBy(desc(assets.sortOrder))
      .limit(1);
    sortOrder = (maxRow[0]?.sortOrder ?? -1) + 1;
  }

  await db.insert(assets).values({
    locationId,
    kind,
    blobUrl: blob.url,
    contentType: file.type,
    sizeBytes: file.size,
    sortOrder,
  });

  revalidatePath(`/locations/${slug}`);
  return { ok: true, kind };
}

export async function deleteAsset(slug: string, assetId: string): Promise<void> {
  await assertCan("manage_config", slug);
  const db = getDb();
  const rows = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
  const row = rows[0];
  if (!row) return;

  try {
    await del(row.blobUrl);
  } catch (err) {
    console.error("blob delete failed", err);
  }
  await db.delete(assets).where(eq(assets.id, assetId));

  revalidatePath(`/locations/${slug}`);
}

export async function reorderGallery(
  slug: string,
  orderedIds: string[],
): Promise<void> {
  await assertCan("manage_config", slug);
  if (orderedIds.length === 0) return;
  const db = getDb();
  // Update each row's sortOrder to match its index in the array.
  await Promise.all(
    orderedIds.map((id, idx) =>
      db.update(assets).set({ sortOrder: idx }).where(eq(assets.id, id)),
    ),
  );
  revalidatePath(`/locations/${slug}`);
}

// ---------------------------------------------------------------------------
// Read helpers (consumed by the Branding & Tours page).
// ---------------------------------------------------------------------------

export async function getAssetsForLocation(
  locationId: string,
): Promise<Record<Asset["kind"], Asset[]>> {
  const db = getDb();
  const rows = await db
    .select()
    .from(assets)
    .where(eq(assets.locationId, locationId))
    .orderBy(asc(assets.sortOrder), asc(assets.createdAt));

  const grouped: Record<Asset["kind"], Asset[]> = {
    hero_desktop: [],
    hero_mobile: [],
    og_image: [],
    gallery_photo: [],
  };
  for (const row of rows) grouped[row.kind].push(row);
  return grouped;
}

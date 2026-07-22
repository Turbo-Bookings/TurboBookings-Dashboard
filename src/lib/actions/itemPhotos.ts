"use server";

import { and, eq } from "drizzle-orm";
import { put, del } from "@vercel/blob";
import { revalidatePath } from "next/cache";
import { recordAudit } from "@/lib/audit";
import { getDb, items } from "@/lib/db";
import { getLocationBySlug } from "@/lib/data/locations";
import { denyIfCannot } from "@/lib/auth/roles";

// Per-tour photos live in items.photoUrls (jsonb string[]); the customer tour
// page renders photoUrls[0] as the hero (pickTourImage). Uploads go to Vercel
// Blob, same store the location media uses.
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_PHOTOS = 8;

export type ItemPhotoState = { ok: true } | { ok: false; error: string };

type LoadedItem =
  | { ok: true; db: ReturnType<typeof getDb>; item: typeof items.$inferSelect }
  | { ok: false; error: string };

async function loadItem(slug: string, itemId: string): Promise<LoadedItem> {
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };
  const db = getDb();
  const item = (
    await db
      .select()
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.locationId, location.id)))
      .limit(1)
  )[0];
  if (!item) return { ok: false, error: "Tour not found" };
  return { ok: true, db, item };
}

export async function uploadItemPhoto(
  slug: string,
  itemId: string,
  _prev: ItemPhotoState | null,
  formData: FormData,
): Promise<ItemPhotoState> {
  const deny = await denyIfCannot("manage_config");
  if (deny) return { ok: false, error: deny };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0)
    return { ok: false, error: "Please choose a photo" };
  if (!ALLOWED.has(file.type))
    return { ok: false, error: "Photo must be a JPEG, PNG, or WebP" };
  if (file.size > MAX_BYTES)
    return { ok: false, error: "Photo must be 5 MB or smaller" };

  const loaded = await loadItem(slug, itemId);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const { db, item } = loaded;
  if (item.photoUrls.length >= MAX_PHOTOS)
    return { ok: false, error: `Up to ${MAX_PHOTOS} photos per tour` };

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const pathname = `${slug}/items/${itemId}/${Date.now()}.${ext}`;
  const blob = await put(pathname, file, { access: "public", contentType: file.type });

  await db
    .update(items)
    .set({ photoUrls: [...item.photoUrls, blob.url], updatedAt: new Date() })
    .where(eq(items.id, itemId));

  await recordAudit({ slug, action: "catalog.item.photo.add", summary: `Added a photo to "${item.name}"`, payload: { itemId } });
  revalidatePath(`/locations/${slug}/catalog/tours/${itemId}`);
  return { ok: true };
}

export async function removeItemPhoto(
  slug: string,
  itemId: string,
  url: string,
): Promise<ItemPhotoState> {
  const deny = await denyIfCannot("manage_config");
  if (deny) return { ok: false, error: deny };
  const loaded = await loadItem(slug, itemId);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const { db, item } = loaded;
  if (!item.photoUrls.includes(url)) return { ok: true };

  try {
    await del(url);
  } catch (err) {
    console.error("blob delete failed", err);
  }
  await db
    .update(items)
    .set({ photoUrls: item.photoUrls.filter((u) => u !== url), updatedAt: new Date() })
    .where(eq(items.id, itemId));

  await recordAudit({ slug, action: "catalog.item.photo.remove", summary: `Removed a photo from "${item.name}"`, payload: { itemId } });
  revalidatePath(`/locations/${slug}/catalog/tours/${itemId}`);
  return { ok: true };
}

// Move a photo to the front — photoUrls[0] is the customer-facing cover/hero.
export async function setItemCoverPhoto(
  slug: string,
  itemId: string,
  url: string,
): Promise<ItemPhotoState> {
  const deny = await denyIfCannot("manage_config");
  if (deny) return { ok: false, error: deny };
  const loaded = await loadItem(slug, itemId);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const { db, item } = loaded;
  if (!item.photoUrls.includes(url)) return { ok: false, error: "Photo not found" };

  const reordered = [url, ...item.photoUrls.filter((u) => u !== url)];
  await db
    .update(items)
    .set({ photoUrls: reordered, updatedAt: new Date() })
    .where(eq(items.id, itemId));

  await recordAudit({ slug, action: "catalog.item.photo.cover", summary: `Set the cover photo for "${item.name}"`, payload: { itemId } });
  revalidatePath(`/locations/${slug}/catalog/tours/${itemId}`);
  return { ok: true };
}

"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { put } from "@vercel/blob";
import { Vibrant } from "node-vibrant/node";
import { getDb, locations } from "@/lib/db";

// node-vibrant returns a Palette with up to 6 named swatches. We surface
// them all to the UI so the operator/VA can pick whichever matches the
// brand best.
export type ExtractedSwatch = {
  /** Category label from Vibrant (Vibrant, LightVibrant, DarkVibrant, etc.) */
  name: string;
  /** Hex string, lowercase, no alpha. */
  hex: string;
};

export type UploadLogoState =
  | { ok: true; logoUrl: string; swatches: ExtractedSwatch[] }
  | { ok: false; error: string };

const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const ALLOWED_LOGO_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);

const SWATCH_LABELS = [
  "Vibrant",
  "LightVibrant",
  "DarkVibrant",
  "Muted",
  "LightMuted",
  "DarkMuted",
] as const;

// Single-step upload: file goes server → Vercel Blob → node-vibrant runs on
// the in-memory buffer → return the public URL + the extracted swatches.
// node-vibrant doesn't ship a meaningful SVG rasterizer, so SVG logos skip
// extraction and the UI falls back to manual hex entry.
export async function uploadLogo(
  slug: string,
  _prev: UploadLogoState | null,
  formData: FormData,
): Promise<UploadLogoState> {
  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Please choose a logo file" };
  }
  if (!ALLOWED_LOGO_TYPES.has(file.type)) {
    return { ok: false, error: "Logo must be PNG, JPEG, WebP, or SVG" };
  }
  if (file.size > MAX_LOGO_BYTES) {
    return { ok: false, error: "Logo must be 5 MB or smaller" };
  }

  // Namespace by slug so it's easy to find / clean up; timestamp prevents
  // collisions when an operator uploads multiple logos while iterating.
  const ext = file.name.split(".").pop() ?? "bin";
  const pathname = `logos/${slug}/${Date.now()}.${ext}`;

  const blob = await put(pathname, file, {
    access: "public",
    contentType: file.type,
  });

  let swatches: ExtractedSwatch[] = [];
  if (file.type !== "image/svg+xml") {
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const palette = await Vibrant.from(buffer).getPalette();
      swatches = SWATCH_LABELS.flatMap((name) => {
        const swatch = palette[name];
        return swatch ? [{ name, hex: swatch.hex.toLowerCase() }] : [];
      });
    } catch (err) {
      console.error("vibrant extraction failed", err);
      // Don't fail the whole upload over color extraction. UI handles
      // empty swatches with a "couldn't extract — enter colors manually"
      // affordance.
    }
  }

  // Persist the logo URL immediately so a refresh shows it even if the
  // operator never clicks Save on the visual identity panel.
  const db = getDb();
  await db
    .update(locations)
    .set({ visualLogoUrl: blob.url, updatedAt: sql`now()` })
    .where(eq(locations.slug, slug));

  revalidatePath(`/locations/${slug}`);

  return { ok: true, logoUrl: blob.url, swatches };
}

// ---------------------------------------------------------------------------
// Save the operator's picks for primary/accent colors + display/body fonts.
// Logo URL isn't included here because uploadLogo persisted it inline.
// ---------------------------------------------------------------------------

export type SaveVisualIdentityState =
  | { ok: true }
  | { ok: false; errors: Partial<Record<string, string>> };

const HEX_RE = /^#[0-9a-f]{6}$/i;

export async function saveVisualIdentity(
  slug: string,
  _prev: SaveVisualIdentityState | null,
  formData: FormData,
): Promise<SaveVisualIdentityState> {
  const primaryColor = String(formData.get("primaryColor") ?? "").trim().toLowerCase();
  const accentColor = String(formData.get("accentColor") ?? "").trim().toLowerCase();
  const displayFont = String(formData.get("displayFont") ?? "").trim();
  const bodyFont = String(formData.get("bodyFont") ?? "").trim();

  const errors: Partial<Record<string, string>> = {};
  if (primaryColor && !HEX_RE.test(primaryColor))
    errors.primaryColor = "Must be a hex color like #c8102e";
  if (accentColor && !HEX_RE.test(accentColor))
    errors.accentColor = "Must be a hex color like #c8102e";

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const db = getDb();
  await db
    .update(locations)
    .set({
      visualPrimaryColor: primaryColor || null,
      visualAccentColor: accentColor || null,
      visualDisplayFont: displayFont || null,
      visualBodyFont: bodyFont || null,
      updatedAt: sql`now()`,
    })
    .where(eq(locations.slug, slug));

  revalidatePath(`/locations/${slug}`);
  return { ok: true };
}

"use server";

import { put } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { recordAudit } from "@/lib/audit";
import { getDb, popupConfig } from "@/lib/db";
import { getLocationBySlug } from "@/lib/data/locations";
import { denyIfCannot } from "@/lib/auth/roles";

// Operator-editable email-capture popup shown on the marketing site. The
// marketing site reads this live via the booking app's /api/popup-config, so
// edits go live without a redeploy.

export type PopupValues = {
  enabled: boolean;
  headline: string;
  subhead: string;
  offer: string;
  buttonLabel: string;
  successMessage: string;
  incentiveCode: string;
  imageUrl: string;
  delaySeconds: string;
  exitIntent: boolean;
  suppressDays: string;
};

export type PopupState =
  | { ok: true; savedAt: number; values: PopupValues }
  | { ok: false; error: string; values: PopupValues };

const DEFAULTS: PopupValues = {
  enabled: false,
  headline: "Get 10% off your ride",
  subhead: "Join our list for a one-time discount + first dibs on deals.",
  offer: "",
  buttonLabel: "Get my code",
  successMessage: "You're in! Check your inbox for the code.",
  incentiveCode: "",
  imageUrl: "",
  delaySeconds: "8",
  exitIntent: true,
  suppressDays: "30",
};

const ALLOWED_IMG = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_IMG_BYTES = 5 * 1024 * 1024;

export async function getPopupValues(slug: string): Promise<PopupValues> {
  const location = await getLocationBySlug(slug);
  if (!location) return DEFAULTS;
  const row = (
    await getDb().select().from(popupConfig).where(eq(popupConfig.locationId, location.id)).limit(1)
  )[0];
  if (!row) return DEFAULTS;
  return {
    enabled: row.enabled,
    headline: row.headline,
    subhead: row.subhead,
    offer: row.offer ?? "",
    buttonLabel: row.buttonLabel,
    successMessage: row.successMessage,
    incentiveCode: row.incentiveCode ?? "",
    imageUrl: row.imageUrl ?? "",
    delaySeconds: String(row.delaySeconds),
    exitIntent: row.exitIntent,
    suppressDays: String(row.suppressDays),
  };
}

export async function updatePopup(
  slug: string,
  _prev: PopupState | null,
  formData: FormData,
): Promise<PopupState> {
  const str = (k: string) => (formData.get(k) as string | null)?.trim() ?? "";
  const values: PopupValues = {
    enabled: formData.get("enabled") === "on",
    headline: str("headline"),
    subhead: str("subhead"),
    offer: str("offer"),
    buttonLabel: str("buttonLabel"),
    successMessage: str("successMessage"),
    incentiveCode: str("incentiveCode"),
    // Existing image (from the hidden field); may be replaced/removed below.
    imageUrl: str("currentImageUrl"),
    delaySeconds: str("delaySeconds"),
    exitIntent: formData.get("exitIntent") === "on",
    suppressDays: str("suppressDays"),
  };

  if (!values.headline) return { ok: false, error: "Headline is required.", values };
  if (!values.buttonLabel) return { ok: false, error: "Button label is required.", values };
  const delay = Number(values.delaySeconds || "0");
  if (!Number.isInteger(delay) || delay < 0 || delay > 120)
    return { ok: false, error: "Delay must be a whole number of seconds (0–120).", values };
  const suppress = Number(values.suppressDays || "0");
  if (!Number.isInteger(suppress) || suppress < 0 || suppress > 365)
    return { ok: false, error: "‘Don’t show again’ must be a whole number of days (0–365).", values };

  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found", values };
  const deny = await denyIfCannot("manage_config", slug);
  if (deny) return { ok: false, error: deny, values };

  // Image: remove, replace via upload, or keep the current one.
  if (formData.get("removeImage") === "on") {
    values.imageUrl = "";
  } else {
    const file = formData.get("imageFile");
    if (file instanceof File && file.size > 0) {
      if (!ALLOWED_IMG.has(file.type))
        return { ok: false, error: "Image must be PNG, JPEG, WebP, or GIF.", values };
      if (file.size > MAX_IMG_BYTES)
        return { ok: false, error: "Image must be 5 MB or smaller.", values };
      const ext = file.name.split(".").pop() ?? "bin";
      const blob = await put(
        `popup/${slug}/${Date.now()}.${ext}`,
        Buffer.from(await file.arrayBuffer()),
        { access: "public", contentType: file.type },
      );
      values.imageUrl = blob.url;
    }
  }

  const row = {
    locationId: location.id,
    enabled: values.enabled,
    headline: values.headline,
    subhead: values.subhead,
    offer: values.offer || null,
    buttonLabel: values.buttonLabel,
    successMessage: values.successMessage,
    incentiveCode: values.incentiveCode || null,
    imageUrl: values.imageUrl || null,
    delaySeconds: delay,
    exitIntent: values.exitIntent,
    suppressDays: suppress,
    updatedAt: new Date(),
  };

  await getDb()
    .insert(popupConfig)
    .values(row)
    .onConflictDoUpdate({ target: popupConfig.locationId, set: row });

  revalidatePath(`/locations/${slug}/settings/popup`);
  await recordAudit({ slug, action: "popup.save", summary: `Popup ${values.enabled ? "enabled" : "disabled"} / updated` });

  return { ok: true, savedAt: Date.now(), values };
}

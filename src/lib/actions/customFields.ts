"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { recordAudit } from "@/lib/audit";
import { customFields, getDb, itemCustomFields } from "@/lib/db";
import { getLocationBySlug } from "@/lib/data/locations";
import { denyIfCannot } from "@/lib/auth/roles";

type FieldErrors = Partial<Record<"label" | "options" | "price" | "form", string>>;

export type CustomFieldFormState = {
  ok: boolean;
  errors: FieldErrors;
  values: {
    kind: string;
    label: string;
    helpText: string;
    required: boolean;
    priceDollars: string;
    optionsText: string;
  };
};

function parse(formData: FormData): CustomFieldFormState["values"] {
  return {
    kind: String(formData.get("kind") ?? "text"),
    label: String(formData.get("label") ?? "").trim(),
    helpText: String(formData.get("helpText") ?? "").trim(),
    required: formData.get("required") != null,
    priceDollars: String(formData.get("priceDollars") ?? "").trim(),
    optionsText: String(formData.get("optionsText") ?? "").trim(),
  };
}

function validate(v: CustomFieldFormState["values"]): FieldErrors {
  const e: FieldErrors = {};
  if (!v.label) e.label = "Required";
  if (v.kind === "dropdown" && !v.optionsText) e.options = "Add at least one option";
  if (v.kind === "quantity" && v.priceDollars && !(Number(v.priceDollars) >= 0))
    e.price = "Enter a valid price";
  return e;
}

function toRow(v: CustomFieldFormState["values"]) {
  const options =
    v.kind === "dropdown"
      ? v.optionsText
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => ({ value: l, label: l }))
      : null;
  return {
    kind: v.kind as "text" | "checkbox" | "dropdown" | "quantity",
    label: v.label,
    helpText: v.helpText || null,
    required: v.required,
    pricePerUnitCents:
      v.kind === "quantity" && v.priceDollars ? Math.round(Number(v.priceDollars) * 100) : null,
    dropdownOptions: options,
  };
}

export async function createCustomField(
  slug: string,
  _prev: CustomFieldFormState | null,
  formData: FormData,
): Promise<CustomFieldFormState> {
  const values = parse(formData);
  const deny = await denyIfCannot("manage_config", slug);
  if (deny) return { ok: false, errors: { form: deny }, values };
  const errors = validate(values);
  if (Object.keys(errors).length) return { ok: false, errors, values };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, errors: { form: "Location not found" }, values };
  const db = getDb();
  await db.insert(customFields).values({ locationId: location.id, ...toRow(values) });
  await recordAudit({ slug, action: "catalog.custom_field.create", summary: `Created custom field "${values.label}"`, payload: { label: values.label } });
  revalidatePath(`/locations/${slug}/catalog/custom-fields`);
  redirect(`/locations/${slug}/catalog/custom-fields`);
}

export async function updateCustomField(
  slug: string,
  id: string,
  _prev: CustomFieldFormState | null,
  formData: FormData,
): Promise<CustomFieldFormState> {
  const values = parse(formData);
  const deny = await denyIfCannot("manage_config", slug);
  if (deny) return { ok: false, errors: { form: deny }, values };
  const errors = validate(values);
  if (Object.keys(errors).length) return { ok: false, errors, values };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, errors: { form: "Location not found" }, values };
  const db = getDb();
  const r = await db
    .update(customFields)
    .set({ ...toRow(values), updatedAt: new Date() })
    .where(and(eq(customFields.id, id), eq(customFields.locationId, location.id)))
    .returning({ id: customFields.id });
  if (!r.length) return { ok: false, errors: { form: "Not found" }, values };
  await recordAudit({ slug, action: "catalog.custom_field.update", summary: `Updated custom field "${values.label}"`, payload: { id } });
  revalidatePath(`/locations/${slug}/catalog/custom-fields`);
  redirect(`/locations/${slug}/catalog/custom-fields`);
}

export async function deleteCustomField(
  slug: string,
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const deny = await denyIfCannot("manage_config", slug);
  if (deny) return { ok: false, error: deny };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };
  const db = getDb();
  try {
    await db
      .delete(customFields)
      .where(and(eq(customFields.id, id), eq(customFields.locationId, location.id)));
  } catch {
    // Has booking responses → archive instead of hard-delete.
    await db
      .update(customFields)
      .set({ archived: true, updatedAt: new Date() })
      .where(and(eq(customFields.id, id), eq(customFields.locationId, location.id)));
  }
  await recordAudit({ slug, action: "catalog.custom_field.delete", summary: "Removed a custom field", payload: { id } });
  revalidatePath(`/locations/${slug}/catalog/custom-fields`);
  return { ok: true };
}

// Whole-booking attach to a set of tours (customer-type-level attach is V1.5).
export async function setFieldAttachments(
  slug: string,
  fieldId: string,
  itemIds: string[],
): Promise<{ ok: boolean; error?: string }> {
  const deny = await denyIfCannot("manage_config", slug);
  if (deny) return { ok: false, error: deny };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };
  const db = getDb();
  const field = (
    await db.select().from(customFields).where(and(eq(customFields.id, fieldId), eq(customFields.locationId, location.id))).limit(1)
  )[0];
  if (!field) return { ok: false, error: "Field not found" };
  await db.delete(itemCustomFields).where(eq(itemCustomFields.customFieldId, fieldId));
  if (itemIds.length)
    await db.insert(itemCustomFields).values(
      itemIds.map((itemId) => ({ itemId, customFieldId: fieldId, attachLevel: "whole_booking" as const })),
    );
  await recordAudit({ slug, action: "catalog.custom_field.attach", summary: `Attached "${field.label}" to ${itemIds.length} tour(s)`, payload: { fieldId } });
  revalidatePath(`/locations/${slug}/catalog/custom-fields/${fieldId}`);
  return { ok: true };
}

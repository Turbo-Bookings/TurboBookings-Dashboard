"use server";
import { assertCan, denyIfCannot } from "@/lib/auth/roles";

import { and, eq, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { recordAudit } from "@/lib/audit";
import { customerTypes, getDb } from "@/lib/db";
import { getLocationBySlug } from "@/lib/data/locations";

type FieldErrors = Partial<
  Record<
    | "singular"
    | "plural"
    | "sku"
    | "minAge"
    | "personsPerUnit"
    | "ticketColor"
    | "form",
    string
  >
>;

export type CustomerTypeFormState = {
  ok: boolean;
  errors: FieldErrors;
  values: {
    singular: string;
    plural: string;
    sku: string;
    note: string;
    minAge: string;
    personsPerUnit: string;
    ticketColor: string;
    excludePricingModifiers: boolean;
    archived: boolean;
  };
};

const HEX_RE = /^#[0-9a-f]{6}$/i;
const SKU_RE = /^[A-Za-z0-9._-]+$/;
const MAX_LABEL_LEN = 64;

function parseFormData(formData: FormData): CustomerTypeFormState["values"] {
  return {
    singular: String(formData.get("singular") ?? "").trim(),
    plural: String(formData.get("plural") ?? "").trim(),
    sku: String(formData.get("sku") ?? "").trim(),
    note: String(formData.get("note") ?? "").trim(),
    minAge: String(formData.get("minAge") ?? "").trim(),
    personsPerUnit: String(formData.get("personsPerUnit") ?? "").trim(),
    ticketColor: String(formData.get("ticketColor") ?? "").trim(),
    excludePricingModifiers: formData.get("excludePricingModifiers") === "on",
    archived: formData.get("archived") === "on",
  };
}

function validate(
  values: CustomerTypeFormState["values"],
): FieldErrors {
  const errors: FieldErrors = {};

  if (!values.singular) errors.singular = "Required";
  else if (values.singular.length > MAX_LABEL_LEN)
    errors.singular = `Keep under ${MAX_LABEL_LEN} characters`;

  if (!values.plural) errors.plural = "Required";
  else if (values.plural.length > MAX_LABEL_LEN)
    errors.plural = `Keep under ${MAX_LABEL_LEN} characters`;

  if (values.sku && !SKU_RE.test(values.sku))
    errors.sku = "Letters, digits, dots, dashes, and underscores only";

  if (values.personsPerUnit) {
    const n = Number(values.personsPerUnit);
    if (!Number.isInteger(n) || n < 1 || n > 20)
      errors.personsPerUnit = "Whole number between 1 and 20";
  }
  if (values.minAge) {
    const n = Number(values.minAge);
    if (!Number.isInteger(n) || n < 0 || n > 120)
      errors.minAge = "Whole number between 0 and 120";
  }

  if (values.ticketColor && !HEX_RE.test(values.ticketColor))
    errors.ticketColor = "Hex color like #c8102e";

  return errors;
}

async function nextSortOrder(locationId: string): Promise<number> {
  const db = getDb();
  const result = await db
    .select({ max: max(customerTypes.sortOrder) })
    .from(customerTypes)
    .where(eq(customerTypes.locationId, locationId));
  return (result[0]?.max ?? -1) + 1;
}

export async function createCustomerType(
  slug: string,
  _prev: CustomerTypeFormState | null,
  formData: FormData,
): Promise<CustomerTypeFormState> {
  const values = parseFormData(formData);
  const deny = await denyIfCannot("manage_config", slug);
  if (deny) return { ok: false, errors: { form: deny }, values };
  const errors = validate(values);
  if (Object.keys(errors).length > 0) return { ok: false, errors, values };

  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, errors: { form: "Location not found" }, values };

  const db = getDb();
  const sortOrder = await nextSortOrder(location.id);

  await db.insert(customerTypes).values({
    locationId: location.id,
    singular: values.singular,
    plural: values.plural,
    sku: values.sku || null,
    note: values.note || null,
    minAge: values.minAge ? Number(values.minAge) : null,
    // Blank means one rider per unit — the only sane default, and the value
    // every existing type already carries.
    personsPerUnit: values.personsPerUnit ? Number(values.personsPerUnit) : 1,
    ticketColor: values.ticketColor || null,
    excludePricingModifiers: values.excludePricingModifiers,
    archived: values.archived,
    sortOrder,
  });

  await recordAudit({
    slug,
    action: "catalog.customer_type.create",
    summary: `Created customer type "${values.singular}"`,
    payload: { singular: values.singular, plural: values.plural },
  });

  revalidatePath(`/locations/${slug}/catalog/customer-types`);
  redirect(`/locations/${slug}/catalog/customer-types`);
}

export async function updateCustomerType(
  slug: string,
  id: string,
  _prev: CustomerTypeFormState | null,
  formData: FormData,
): Promise<CustomerTypeFormState> {
  const values = parseFormData(formData);
  const deny = await denyIfCannot("manage_config", slug);
  if (deny) return { ok: false, errors: { form: deny }, values };
  const errors = validate(values);
  if (Object.keys(errors).length > 0) return { ok: false, errors, values };

  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, errors: { form: "Location not found" }, values };

  const db = getDb();
  const result = await db
    .update(customerTypes)
    .set({
      singular: values.singular,
      plural: values.plural,
      sku: values.sku || null,
      note: values.note || null,
      minAge: values.minAge ? Number(values.minAge) : null,
    // Blank means one rider per unit — the only sane default, and the value
    // every existing type already carries.
    personsPerUnit: values.personsPerUnit ? Number(values.personsPerUnit) : 1,
      ticketColor: values.ticketColor || null,
      excludePricingModifiers: values.excludePricingModifiers,
      archived: values.archived,
      updatedAt: new Date(),
    })
    .where(
      and(eq(customerTypes.id, id), eq(customerTypes.locationId, location.id)),
    )
    .returning({ id: customerTypes.id });

  if (result.length === 0) {
    return { ok: false, errors: { form: "Customer type not found" }, values };
  }

  await recordAudit({
    slug,
    action: "catalog.customer_type.update",
    summary: `Updated customer type "${values.singular}"`,
    payload: { id, archived: values.archived },
  });

  revalidatePath(`/locations/${slug}/catalog/customer-types`);
  redirect(`/locations/${slug}/catalog/customer-types`);
}

export async function setCustomerTypeArchived(
  slug: string,
  id: string,
  archived: boolean,
): Promise<void> {
  await assertCan("manage_config", slug);
  const location = await getLocationBySlug(slug);
  if (!location) return;
  const db = getDb();
  const before = await db
    .select({ singular: customerTypes.singular })
    .from(customerTypes)
    .where(
      and(eq(customerTypes.id, id), eq(customerTypes.locationId, location.id)),
    )
    .limit(1);
  if (!before[0]) return;

  await db
    .update(customerTypes)
    .set({ archived, updatedAt: new Date() })
    .where(
      and(eq(customerTypes.id, id), eq(customerTypes.locationId, location.id)),
    );

  await recordAudit({
    slug,
    action: archived
      ? "catalog.customer_type.archive"
      : "catalog.customer_type.unarchive",
    summary: `${archived ? "Archived" : "Unarchived"} customer type "${before[0].singular}"`,
    payload: { id },
  });

  revalidatePath(`/locations/${slug}/catalog/customer-types`);
}

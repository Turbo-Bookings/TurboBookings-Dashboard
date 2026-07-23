"use server";

import { and, eq, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { recordAudit } from "@/lib/audit";
import {
  customerTypes,
  getDb,
  itemCustomerTypes,
  items,
  resourceRequirements,
  resources,
} from "@/lib/db";
import { getLocationBySlug } from "@/lib/data/locations";
import { assertCan, denyIfCannot } from "@/lib/auth/roles";

type ItemFieldErrors = Partial<
  Record<
    "name" | "defaultDurationMinutes" | "descriptionMd" | "capacityMode" | "minAge" | "form",
    string
  >
>;

const CAPACITY_MODES = ["resource_based", "fixed"] as const;
type CapacityMode = (typeof CAPACITY_MODES)[number];

export type ItemFormState = {
  ok: boolean;
  errors: ItemFieldErrors;
  values: {
    name: string;
    descriptionMd: string;
    highlights: string[];
    included: string[];
    whatToBring: string[];
    minAge: string;
    languages: string[];
    groupSizeLabel: string;
    faqs: { q: string; a: string }[];
    cancellationNotesMd: string;
    defaultDurationMinutes: string;
    capacityMode: string;
    bookableOnline: boolean;
    listingVisible: boolean;
  };
};

const MAX_NAME_LEN = 120;
const MAX_DESC_LEN = 8000;
const MAX_LIST_ITEMS = 15;
const MAX_LIST_ITEM_LEN = 160;

// Parse a StringListField's hidden JSON input into a clean string array
// (trim, drop blanks, cap count + per-item length).
function parseStringList(raw: FormDataEntryValue | null): string[] {
  if (typeof raw !== "string" || !raw) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim().slice(0, MAX_LIST_ITEM_LEN))
    .filter(Boolean)
    .slice(0, MAX_LIST_ITEMS);
}

// Parse a FaqEditor's hidden JSON input into clean {q,a} pairs (both non-empty).
function parseFaqs(raw: FormDataEntryValue | null): { q: string; a: string }[] {
  if (typeof raw !== "string" || !raw) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => {
      const o = x as { q?: unknown; a?: unknown };
      return {
        q: typeof o.q === "string" ? o.q.trim().slice(0, 200) : "",
        a: typeof o.a === "string" ? o.a.trim().slice(0, 1000) : "",
      };
    })
    .filter((p) => p.q && p.a)
    .slice(0, 20);
}

function parseItemForm(formData: FormData): ItemFormState["values"] {
  return {
    name: String(formData.get("name") ?? "").trim(),
    descriptionMd: String(formData.get("descriptionMd") ?? ""),
    highlights: parseStringList(formData.get("highlights")),
    included: parseStringList(formData.get("included")),
    whatToBring: parseStringList(formData.get("whatToBring")),
    minAge: String(formData.get("minAge") ?? "").trim(),
    languages: parseStringList(formData.get("languages")),
    groupSizeLabel: String(formData.get("groupSizeLabel") ?? "").trim(),
    faqs: parseFaqs(formData.get("faqs")),
    cancellationNotesMd: String(formData.get("cancellationNotesMd") ?? ""),
    defaultDurationMinutes: String(
      formData.get("defaultDurationMinutes") ?? "",
    ).trim(),
    capacityMode: String(formData.get("capacityMode") ?? "resource_based"),
    bookableOnline: formData.get("bookableOnline") === "on",
    listingVisible: formData.get("listingVisible") === "on",
  };
}

// Optional whole-number age (blank → null). Returns undefined on invalid input
// so the caller can flag it.
function parseMinAge(raw: string): number | null | undefined {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 120) return undefined;
  return n;
}

function validateItem(values: ItemFormState["values"]): ItemFieldErrors {
  const errors: ItemFieldErrors = {};
  if (!values.name) errors.name = "Required";
  else if (values.name.length > MAX_NAME_LEN)
    errors.name = `Keep under ${MAX_NAME_LEN} characters`;

  if (!CAPACITY_MODES.includes(values.capacityMode as CapacityMode))
    errors.capacityMode = "Pick a capacity mode";

  const dur = Number(values.defaultDurationMinutes);
  if (!values.defaultDurationMinutes)
    errors.defaultDurationMinutes = "Required";
  else if (!Number.isInteger(dur) || dur < 1)
    errors.defaultDurationMinutes = "Whole number of minutes, at least 1";
  else if (dur > 24 * 60)
    errors.defaultDurationMinutes = "Keep under 24 hours";

  if (values.descriptionMd.length > MAX_DESC_LEN)
    errors.descriptionMd = `Keep under ${MAX_DESC_LEN} characters`;

  if (parseMinAge(values.minAge) === undefined)
    errors.minAge = "Whole number 0–120 (or blank)";

  return errors;
}

async function nextItemSortOrder(locationId: string): Promise<number> {
  const db = getDb();
  const r = await db
    .select({ max: max(items.sortOrder) })
    .from(items)
    .where(eq(items.locationId, locationId));
  return (r[0]?.max ?? -1) + 1;
}

export async function createItem(
  slug: string,
  _prev: ItemFormState | null,
  formData: FormData,
): Promise<ItemFormState> {
  const values = parseItemForm(formData);
  const deny = await denyIfCannot("manage_config");
  if (deny) return { ok: false, errors: { form: deny }, values };
  const errors = validateItem(values);
  if (Object.keys(errors).length > 0) return { ok: false, errors, values };

  const location = await getLocationBySlug(slug);
  if (!location)
    return { ok: false, errors: { form: "Location not found" }, values };

  const db = getDb();
  const sortOrder = await nextItemSortOrder(location.id);

  const result = await db
    .insert(items)
    .values({
      locationId: location.id,
      name: values.name,
      descriptionMd: values.descriptionMd || null,
      highlights: values.highlights,
      included: values.included,
      whatToBring: values.whatToBring,
      minAge: parseMinAge(values.minAge) ?? null,
      languages: values.languages,
      groupSizeLabel: values.groupSizeLabel || null,
      faqs: values.faqs,
      cancellationNotesMd: values.cancellationNotesMd || null,
      defaultDurationMinutes: Number(values.defaultDurationMinutes),
      capacityMode: values.capacityMode as CapacityMode,
      bookableOnline: values.bookableOnline,
      listingVisible: values.listingVisible,
      sortOrder,
    })
    .returning({ id: items.id });

  const newId = result[0]?.id;

  await recordAudit({
    slug,
    action: "catalog.item.create",
    summary: `Created tour "${values.name}"`,
    payload: {
      name: values.name,
      defaultDurationMinutes: Number(values.defaultDurationMinutes),
    },
  });

  revalidatePath(`/locations/${slug}/catalog/tours`);
  // Send the operator straight into the pricing matrix — an item without
  // any item_customer_types isn't bookable, so this nudges the next step.
  if (newId) redirect(`/locations/${slug}/catalog/tours/${newId}/pricing`);
  redirect(`/locations/${slug}/catalog/tours`);
}

export async function updateItem(
  slug: string,
  id: string,
  _prev: ItemFormState | null,
  formData: FormData,
): Promise<ItemFormState> {
  const values = parseItemForm(formData);
  const deny = await denyIfCannot("manage_config");
  if (deny) return { ok: false, errors: { form: deny }, values };
  const errors = validateItem(values);
  if (Object.keys(errors).length > 0) return { ok: false, errors, values };

  const location = await getLocationBySlug(slug);
  if (!location)
    return { ok: false, errors: { form: "Location not found" }, values };

  const db = getDb();
  const r = await db
    .update(items)
    .set({
      name: values.name,
      descriptionMd: values.descriptionMd || null,
      highlights: values.highlights,
      included: values.included,
      whatToBring: values.whatToBring,
      minAge: parseMinAge(values.minAge) ?? null,
      languages: values.languages,
      groupSizeLabel: values.groupSizeLabel || null,
      faqs: values.faqs,
      cancellationNotesMd: values.cancellationNotesMd || null,
      defaultDurationMinutes: Number(values.defaultDurationMinutes),
      capacityMode: values.capacityMode as CapacityMode,
      bookableOnline: values.bookableOnline,
      listingVisible: values.listingVisible,
      updatedAt: new Date(),
    })
    .where(and(eq(items.id, id), eq(items.locationId, location.id)))
    .returning({ id: items.id });

  if (r.length === 0)
    return { ok: false, errors: { form: "Tour not found" }, values };

  await recordAudit({
    slug,
    action: "catalog.item.update",
    summary: `Updated tour "${values.name}"`,
    payload: { id },
  });

  revalidatePath(`/locations/${slug}/catalog/tours`);
  redirect(`/locations/${slug}/catalog/tours`);
}

export async function deleteItem(
  slug: string,
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const deny = await denyIfCannot("manage_config");
  if (deny) return { ok: false, error: deny };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };

  const db = getDb();
  const before = await db
    .select({ name: items.name })
    .from(items)
    .where(and(eq(items.id, id), eq(items.locationId, location.id)))
    .limit(1);
  if (!before[0]) return { ok: false, error: "Tour not found" };

  try {
    await db
      .delete(items)
      .where(and(eq(items.id, id), eq(items.locationId, location.id)));
  } catch (err) {
    if (err instanceof Error && err.message.includes("bookings_item_id_items_id_fk")) {
      return {
        ok: false,
        error:
          "Tour has existing bookings. Hide it from online booking + listings instead of deleting.",
      };
    }
    throw err;
  }

  await recordAudit({
    slug,
    action: "catalog.item.delete",
    summary: `Deleted tour "${before[0].name}"`,
    payload: { id },
  });

  revalidatePath(`/locations/${slug}/catalog/tours`);
  return { ok: true };
}

// ---------- Pricing matrix actions ----------

export async function addCustomerTypeToItem(
  slug: string,
  itemId: string,
  customerTypeId: string,
): Promise<void> {
  await assertCan("manage_config");
  const location = await getLocationBySlug(slug);
  if (!location) return;

  const db = getDb();

  // Belt-and-suspenders: both rows must belong to this location.
  const [item, ct] = await Promise.all([
    db
      .select({ id: items.id, name: items.name })
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.locationId, location.id)))
      .limit(1),
    db
      .select({ id: customerTypes.id, singular: customerTypes.singular })
      .from(customerTypes)
      .where(
        and(
          eq(customerTypes.id, customerTypeId),
          eq(customerTypes.locationId, location.id),
        ),
      )
      .limit(1),
  ]);
  if (!item[0] || !ct[0]) return;

  // Sort order: place at end of current item's list.
  const existing = await db
    .select({ max: max(itemCustomerTypes.sortOrder) })
    .from(itemCustomerTypes)
    .where(eq(itemCustomerTypes.itemId, itemId));
  const sortOrder = (existing[0]?.max ?? -1) + 1;

  await db.insert(itemCustomerTypes).values({
    itemId,
    customerTypeId,
    priceCents: 0,
    visibility: "visible",
    minQuantity: 0,
    sortOrder,
  });

  await recordAudit({
    slug,
    action: "catalog.item_customer_type.add",
    summary: `Added "${ct[0].singular}" to tour "${item[0].name}"`,
    payload: { itemId, customerTypeId },
  });

  revalidatePath(`/locations/${slug}/catalog/tours/${itemId}/pricing`);
}

export async function removeCustomerTypeFromItem(
  slug: string,
  itemId: string,
  customerTypeId: string,
): Promise<void> {
  await assertCan("manage_config");
  const location = await getLocationBySlug(slug);
  if (!location) return;

  const db = getDb();
  const item = await db
    .select({ name: items.name })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.locationId, location.id)))
    .limit(1);
  if (!item[0]) return;

  await db
    .delete(itemCustomerTypes)
    .where(
      and(
        eq(itemCustomerTypes.itemId, itemId),
        eq(itemCustomerTypes.customerTypeId, customerTypeId),
      ),
    );

  await recordAudit({
    slug,
    action: "catalog.item_customer_type.remove",
    summary: `Removed customer type from tour "${item[0].name}"`,
    payload: { itemId, customerTypeId },
  });

  revalidatePath(`/locations/${slug}/catalog/tours/${itemId}/pricing`);
}

type PricingRowInput = {
  id: string;
  priceCents: number;
  taxRateBpsOverride: number | null;
  visibility: "visible" | "hidden";
  minQuantity: number;
  maxQuantity: number | null;
};

type PricingRowErrors = Partial<
  Record<"priceCents" | "taxRateBpsOverride" | "minQuantity" | "maxQuantity", string>
>;

export type SavePricingState = {
  ok: boolean;
  rowErrors: Record<string, PricingRowErrors>;
  formError?: string;
};

function parsePricingRow(raw: unknown): PricingRowInput | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== "string") return null;

  const priceCents = typeof obj.priceCents === "number" ? obj.priceCents : 0;
  const taxRateBpsOverride =
    typeof obj.taxRateBpsOverride === "number"
      ? obj.taxRateBpsOverride
      : null;
  const visibility = obj.visibility === "hidden" ? "hidden" : "visible";
  const minQuantity = typeof obj.minQuantity === "number" ? obj.minQuantity : 0;
  const maxQuantity =
    typeof obj.maxQuantity === "number" ? obj.maxQuantity : null;

  return {
    id: obj.id,
    priceCents,
    taxRateBpsOverride,
    visibility,
    minQuantity,
    maxQuantity,
  };
}

function validatePricingRow(row: PricingRowInput): PricingRowErrors {
  const errors: PricingRowErrors = {};
  if (!Number.isInteger(row.priceCents) || row.priceCents < 0)
    errors.priceCents = "Non-negative whole cents";
  if (
    row.taxRateBpsOverride != null &&
    (!Number.isInteger(row.taxRateBpsOverride) ||
      row.taxRateBpsOverride < 0 ||
      row.taxRateBpsOverride > 10_000)
  )
    errors.taxRateBpsOverride = "0–100%";
  if (!Number.isInteger(row.minQuantity) || row.minQuantity < 0)
    errors.minQuantity = "0 or more";
  if (row.maxQuantity != null) {
    if (!Number.isInteger(row.maxQuantity) || row.maxQuantity < 1)
      errors.maxQuantity = "1 or more, or leave blank";
    else if (row.maxQuantity < row.minQuantity)
      errors.maxQuantity = "Max must be ≥ min";
  }
  return errors;
}

export async function saveItemPricing(
  slug: string,
  itemId: string,
  _prev: SavePricingState | null,
  formData: FormData,
): Promise<SavePricingState> {
  const deny = await denyIfCannot("manage_config");
  if (deny) return { ok: false, rowErrors: {}, formError: deny };
  const location = await getLocationBySlug(slug);
  if (!location)
    return { ok: false, rowErrors: {}, formError: "Location not found" };

  const raw = formData.get("rows");
  if (typeof raw !== "string")
    return { ok: false, rowErrors: {}, formError: "Missing rows payload" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, rowErrors: {}, formError: "Malformed rows payload" };
  }
  if (!Array.isArray(parsed))
    return { ok: false, rowErrors: {}, formError: "Malformed rows payload" };

  const rows: PricingRowInput[] = [];
  for (const r of parsed) {
    const parsedRow = parsePricingRow(r);
    if (!parsedRow)
      return { ok: false, rowErrors: {}, formError: "Malformed row" };
    rows.push(parsedRow);
  }

  const rowErrors: Record<string, PricingRowErrors> = {};
  let hasErrors = false;
  for (const row of rows) {
    const errs = validatePricingRow(row);
    if (Object.keys(errs).length > 0) {
      rowErrors[row.id] = errs;
      hasErrors = true;
    }
  }
  if (hasErrors) return { ok: false, rowErrors };

  const db = getDb();
  const item = await db
    .select({ name: items.name })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.locationId, location.id)))
    .limit(1);
  if (!item[0])
    return { ok: false, rowErrors: {}, formError: "Tour not found" };

  // Batch update each row; this isn't a transactional sweep but it's
  // idempotent and per-row failures bubble up via the catch below.
  for (const row of rows) {
    await db
      .update(itemCustomerTypes)
      .set({
        priceCents: row.priceCents,
        taxRateBpsOverride: row.taxRateBpsOverride,
        visibility: row.visibility,
        minQuantity: row.minQuantity,
        maxQuantity: row.maxQuantity,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(itemCustomerTypes.id, row.id),
          eq(itemCustomerTypes.itemId, itemId),
        ),
      );
  }

  await recordAudit({
    slug,
    action: "catalog.item_pricing.save",
    summary: `Saved pricing for tour "${item[0].name}" (${rows.length} customer types)`,
    payload: { itemId, rowCount: rows.length },
  });

  revalidatePath(`/locations/${slug}/catalog/tours/${itemId}/pricing`);
  return { ok: true, rowErrors: {} };
}

// ---------- Resource requirements actions ----------

type ResourceReqInput = {
  customerTypeId: string;
  resourceId: string;
  quantityConsumed: number;
};

export type SaveResourceReqState = {
  ok: boolean;
  // Keyed by `${customerTypeId}:${resourceId}` so the editor can flag a cell.
  cellErrors: Record<string, string>;
  formError?: string;
};

const MAX_QTY_CONSUMED = 1000;

function parseResourceReqRow(raw: unknown): ResourceReqInput | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.customerTypeId !== "string") return null;
  if (typeof obj.resourceId !== "string") return null;
  // Blank/zero cells arrive as 0 and mean "no requirement" — kept so the
  // diff below can delete a previously-set cell that was cleared.
  const quantityConsumed =
    typeof obj.quantityConsumed === "number" ? obj.quantityConsumed : NaN;
  return {
    customerTypeId: obj.customerTypeId,
    resourceId: obj.resourceId,
    quantityConsumed,
  };
}

export async function saveItemResourceRequirements(
  slug: string,
  itemId: string,
  _prev: SaveResourceReqState | null,
  formData: FormData,
): Promise<SaveResourceReqState> {
  const deny = await denyIfCannot("manage_config");
  if (deny) return { ok: false, cellErrors: {}, formError: deny };
  const location = await getLocationBySlug(slug);
  if (!location)
    return { ok: false, cellErrors: {}, formError: "Location not found" };

  const raw = formData.get("cells");
  if (typeof raw !== "string")
    return { ok: false, cellErrors: {}, formError: "Missing cells payload" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, cellErrors: {}, formError: "Malformed cells payload" };
  }
  if (!Array.isArray(parsed))
    return { ok: false, cellErrors: {}, formError: "Malformed cells payload" };

  const cells: ResourceReqInput[] = [];
  for (const r of parsed) {
    const row = parseResourceReqRow(r);
    if (!row)
      return { ok: false, cellErrors: {}, formError: "Malformed cell" };
    cells.push(row);
  }

  const db = getDb();
  const item = await db
    .select({ name: items.name })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.locationId, location.id)))
    .limit(1);
  if (!item[0])
    return { ok: false, cellErrors: {}, formError: "Tour not found" };

  // Whitelist valid IDs: customer types must be ON this tour, resources must
  // belong to this location. Anything else is silently dropped.
  const [attachedCts, locationResources] = await Promise.all([
    db
      .select({ id: itemCustomerTypes.customerTypeId })
      .from(itemCustomerTypes)
      .where(eq(itemCustomerTypes.itemId, itemId)),
    db
      .select({ id: resources.id })
      .from(resources)
      .where(eq(resources.locationId, location.id)),
  ]);
  const validCt = new Set(attachedCts.map((r) => r.id));
  const validRes = new Set(locationResources.map((r) => r.id));

  // Validate quantities; only cells in range with valid IDs are considered.
  const cellErrors: Record<string, string> = {};
  const desired = new Map<string, ResourceReqInput>();
  for (const c of cells) {
    if (!validCt.has(c.customerTypeId) || !validRes.has(c.resourceId)) continue;
    const key = `${c.customerTypeId}:${c.resourceId}`;
    const q = c.quantityConsumed;
    if (Number.isNaN(q)) continue; // blank cell → no requirement
    if (!Number.isInteger(q) || q < 0 || q > MAX_QTY_CONSUMED) {
      cellErrors[key] = `Whole number 0–${MAX_QTY_CONSUMED}`;
      continue;
    }
    if (q >= 1) desired.set(key, c);
  }
  if (Object.keys(cellErrors).length > 0) return { ok: false, cellErrors };

  const existing = await db
    .select()
    .from(resourceRequirements)
    .where(eq(resourceRequirements.itemId, itemId));
  const existingByKey = new Map(
    existing.map((r) => [`${r.customerTypeId}:${r.resourceId}`, r]),
  );

  // Diff: delete cleared cells, insert new ones, update changed quantities.
  // One statement per change, mirroring the pricing save (neon-http has no
  // multi-statement transaction); each diff op is independently idempotent.
  for (const [key, row] of existingByKey) {
    if (!desired.has(key)) {
      await db
        .delete(resourceRequirements)
        .where(eq(resourceRequirements.id, row.id));
    }
  }
  for (const [key, cell] of desired) {
    const ex = existingByKey.get(key);
    if (!ex) {
      await db.insert(resourceRequirements).values({
        itemId,
        customerTypeId: cell.customerTypeId,
        resourceId: cell.resourceId,
        quantityConsumed: cell.quantityConsumed,
      });
    } else if (ex.quantityConsumed !== cell.quantityConsumed) {
      await db
        .update(resourceRequirements)
        .set({ quantityConsumed: cell.quantityConsumed })
        .where(eq(resourceRequirements.id, ex.id));
    }
  }

  await recordAudit({
    slug,
    action: "catalog.item_resource_requirements.save",
    summary: `Saved resource requirements for tour "${item[0].name}" (${desired.size} mappings)`,
    payload: { itemId, mappingCount: desired.size },
  });

  revalidatePath(`/locations/${slug}/catalog/tours/${itemId}/resources`);
  return { ok: true, cellErrors: {} };
}

"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { recordAudit } from "@/lib/audit";
import { discountCodes, getDb } from "@/lib/db";
import { getLocationBySlug } from "@/lib/data/locations";
import { denyIfCannot } from "@/lib/auth/roles";

type FieldErrors = Partial<
  Record<"code" | "amount" | "maxUses" | "validUntil" | "form", string>
>;

export type DiscountFormState = {
  ok: boolean;
  errors: FieldErrors;
  values: {
    code: string;
    amountKind: string; // "fixed" | "percent"
    amount: string; // dollars (fixed) or percent (percent)
    applyMode: string; // "order_total" | "per_item"
    validDaysOfWeek: number[]; // 0=Sun … 6=Sat; empty = any day
    maxUses: string;
    active: boolean;
    validFrom: string;
    validUntil: string;
    appliesToItemIds: string[];
  };
};

function parse(formData: FormData): DiscountFormState["values"] {
  return {
    code: String(formData.get("code") ?? "").trim().toUpperCase(),
    amountKind: String(formData.get("amountKind") ?? "fixed"),
    amount: String(formData.get("amount") ?? "").trim(),
    applyMode: String(formData.get("applyMode") ?? "order_total"),
    validDaysOfWeek: [...new Set(formData.getAll("validDaysOfWeek").map(Number))]
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
      .sort((a, b) => a - b),
    maxUses: String(formData.get("maxUses") ?? "").trim(),
    active: formData.get("active") != null,
    validFrom: String(formData.get("validFrom") ?? "").trim(),
    validUntil: String(formData.get("validUntil") ?? "").trim(),
    appliesToItemIds: formData.getAll("appliesToItemIds").map(String),
  };
}

function validate(v: DiscountFormState["values"]): FieldErrors {
  const e: FieldErrors = {};
  if (!v.code) e.code = "Required";
  else if (!/^[A-Z0-9_-]{2,40}$/.test(v.code)) e.code = "Letters, numbers, - or _";
  const amt = Number(v.amount);
  if (!v.amount || !(amt > 0)) e.amount = "Enter an amount > 0";
  else if (v.amountKind === "percent" && amt > 100) e.amount = "Percent can't exceed 100";
  if (v.maxUses && (!Number.isInteger(Number(v.maxUses)) || Number(v.maxUses) < 1))
    e.maxUses = "Whole number ≥ 1, or blank for unlimited";
  if (v.validFrom && v.validUntil && v.validUntil < v.validFrom)
    e.validUntil = "End must be after start";
  return e;
}

function toRow(v: DiscountFormState["values"]) {
  const amt = Number(v.amount);
  return {
    code: v.code,
    amountKind: v.amountKind as "fixed" | "percent",
    amountValue:
      v.amountKind === "percent" ? Math.round(amt * 100) : Math.round(amt * 100),
    applyMode: (v.applyMode === "per_item" ? "per_item" : "order_total") as
      | "per_item"
      | "order_total",
    validDaysOfWeek: v.validDaysOfWeek,
    maxUses: v.maxUses ? Number(v.maxUses) : null,
    active: v.active,
    appliesToItemIds: v.appliesToItemIds,
    appliesToCustomerTypeIds: [] as string[],
    validFrom: v.validFrom ? new Date(`${v.validFrom}T00:00:00Z`) : null,
    validUntil: v.validUntil ? new Date(`${v.validUntil}T23:59:59Z`) : null,
  };
}

export async function createDiscountCode(
  slug: string,
  _prev: DiscountFormState | null,
  formData: FormData,
): Promise<DiscountFormState> {
  const values = parse(formData);
  const deny = await denyIfCannot("manage_config", slug);
  if (deny) return { ok: false, errors: { form: deny }, values };
  const errors = validate(values);
  if (Object.keys(errors).length) return { ok: false, errors, values };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, errors: { form: "Location not found" }, values };
  const db = getDb();
  try {
    await db.insert(discountCodes).values({ locationId: location.id, ...toRow(values) });
  } catch (err) {
    if (err instanceof Error && err.message.includes("discount_codes_location_code_idx"))
      return { ok: false, errors: { code: "That code already exists" }, values };
    throw err;
  }
  await recordAudit({ slug, action: "catalog.discount.create", summary: `Created discount ${values.code}`, payload: { code: values.code } });
  revalidatePath(`/locations/${slug}/catalog/discounts`);
  redirect(`/locations/${slug}/catalog/discounts`);
}

export async function updateDiscountCode(
  slug: string,
  id: string,
  _prev: DiscountFormState | null,
  formData: FormData,
): Promise<DiscountFormState> {
  const values = parse(formData);
  const deny = await denyIfCannot("manage_config", slug);
  if (deny) return { ok: false, errors: { form: deny }, values };
  const errors = validate(values);
  if (Object.keys(errors).length) return { ok: false, errors, values };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, errors: { form: "Location not found" }, values };
  const db = getDb();
  try {
    const r = await db
      .update(discountCodes)
      .set({ ...toRow(values), updatedAt: new Date() })
      .where(and(eq(discountCodes.id, id), eq(discountCodes.locationId, location.id)))
      .returning({ id: discountCodes.id });
    if (!r.length) return { ok: false, errors: { form: "Not found" }, values };
  } catch (err) {
    if (err instanceof Error && err.message.includes("discount_codes_location_code_idx"))
      return { ok: false, errors: { code: "That code already exists" }, values };
    throw err;
  }
  await recordAudit({ slug, action: "catalog.discount.update", summary: `Updated discount ${values.code}`, payload: { id } });
  revalidatePath(`/locations/${slug}/catalog/discounts`);
  redirect(`/locations/${slug}/catalog/discounts`);
}

export async function deleteDiscountCode(
  slug: string,
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const deny = await denyIfCannot("manage_config", slug);
  if (deny) return { ok: false, error: deny };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };
  const db = getDb();
  await db
    .delete(discountCodes)
    .where(and(eq(discountCodes.id, id), eq(discountCodes.locationId, location.id)));
  await recordAudit({ slug, action: "catalog.discount.delete", summary: "Deleted a discount code", payload: { id } });
  revalidatePath(`/locations/${slug}/catalog/discounts`);
  return { ok: true };
}

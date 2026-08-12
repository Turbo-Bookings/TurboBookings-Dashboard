"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { recordAudit } from "@/lib/audit";
import { getDb, locations } from "@/lib/db";
import { getLocationBySlug } from "@/lib/data/locations";
import { can, denyIfCannot } from "@/lib/auth/roles";

type FieldErrors = Partial<Record<"taxRate" | "platformFee" | "deposit" | "form", string>>;

export type TaxesFeesState = {
  ok: boolean;
  errors: FieldErrors;
  values: {
    taxRatePct: string;
    taxMode: string;
    platformFeePct: string;
    platformFeeMode: string;
    depositMode: string;
    depositAmount: string;
    depositPercent: string;
  };
};

const CHARGE_MODES = ["passed_to_customer", "absorbed_by_client"];
const DEPOSIT_MODES = ["full", "flat", "per_person", "per_unit", "percent"];

function parse(formData: FormData): TaxesFeesState["values"] {
  return {
    taxRatePct: String(formData.get("taxRatePct") ?? "").trim(),
    taxMode: String(formData.get("taxMode") ?? "passed_to_customer"),
    platformFeePct: String(formData.get("platformFeePct") ?? "").trim(),
    platformFeeMode: String(formData.get("platformFeeMode") ?? "passed_to_customer"),
    depositMode: String(formData.get("depositMode") ?? "full"),
    depositAmount: String(formData.get("depositAmount") ?? "").trim(),
    depositPercent: String(formData.get("depositPercent") ?? "").trim(),
  };
}

function pct(v: string): number | null {
  if (v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

export async function updateTaxesFees(
  slug: string,
  _prev: TaxesFeesState | null,
  formData: FormData,
): Promise<TaxesFeesState> {
  const values = parse(formData);
  const errors: FieldErrors = {};

  // The processing/platform fee is Turbo-only (manage_platform). Operators
  // don't see the fields and can't change the fee — validate + write it only
  // for privileged users; otherwise the existing fee is preserved.
  const canFee = await can("manage_platform");

  const tax = pct(values.taxRatePct);
  if (tax == null) errors.taxRate = "0–100";
  let fee: number | null = null;
  if (canFee) {
    fee = pct(values.platformFeePct);
    if (fee == null) errors.platformFee = "0–100";
    if (!CHARGE_MODES.includes(values.platformFeeMode)) errors.form = "Invalid mode";
  }
  if (!CHARGE_MODES.includes(values.taxMode)) errors.form = "Invalid mode";
  if (!DEPOSIT_MODES.includes(values.depositMode)) errors.deposit = "Invalid deposit mode";

  let depositAmountCents: number | null = null;
  let depositPercentBps: number | null = null;
  if (["flat", "per_person", "per_unit"].includes(values.depositMode)) {
    const a = Number(values.depositAmount);
    if (!values.depositAmount || !(a > 0)) errors.deposit = "Enter a deposit amount";
    else depositAmountCents = Math.round(a * 100);
  } else if (values.depositMode === "percent") {
    const dp = pct(values.depositPercent);
    if (dp == null || dp <= 0) errors.deposit = "Enter a deposit percent (1–100)";
    else depositPercentBps = Math.round(dp * 100);
  }

  if (Object.keys(errors).length) return { ok: false, errors, values };

  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, errors: { form: "Location not found" }, values };
  const deny = await denyIfCannot("manage_config");
  if (deny) return { ok: false, errors: { form: deny }, values };

  const db = getDb();
  await db
    .update(locations)
    .set({
      taxRateBps: Math.round((tax ?? 0) * 100),
      taxMode: values.taxMode as "passed_to_customer",
      // Only privileged users write the fee; operators leave it untouched.
      ...(canFee
        ? {
            platformFeeBps: Math.round((fee ?? 0) * 100),
            platformFeeMode: values.platformFeeMode as "passed_to_customer",
          }
        : {}),
      depositMode: values.depositMode as "full",
      depositAmountCents,
      depositPercentBps,
      updatedAt: new Date(),
    })
    .where(eq(locations.id, location.id));

  await recordAudit({
    slug,
    action: "settings.taxes_fees.update",
    summary: `Taxes & fees: tax ${tax}%${canFee ? `, fee ${fee}%` : ""}, deposit ${values.depositMode}`,
    payload: { tax, fee: canFee ? fee : undefined, depositMode: values.depositMode },
  });
  revalidatePath(`/locations/${slug}/settings/taxes-fees`);
  revalidatePath(`/locations/${slug}/settings`);
  return { ok: true, errors: {}, values };
}

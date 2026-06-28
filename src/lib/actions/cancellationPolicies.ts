"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { recordAudit } from "@/lib/audit";
import {
  cancellationPolicies,
  cancellationPolicyRules,
  getDb,
  locations,
} from "@/lib/db";
import { getLocationBySlug } from "@/lib/data/locations";

type FieldErrors = Partial<Record<"name" | "grace" | "rules" | "form", string>>;

export type PolicyFormState = {
  ok: boolean;
  errors: FieldErrors;
  values: {
    name: string;
    gracePeriodMinutes: string;
    isDefault: boolean;
    ruleHours: string[];
    rulePct: string[];
  };
};

function parse(formData: FormData): PolicyFormState["values"] {
  return {
    name: String(formData.get("name") ?? "").trim(),
    gracePeriodMinutes: String(formData.get("gracePeriodMinutes") ?? "0").trim(),
    isDefault: formData.get("isDefault") != null,
    ruleHours: formData.getAll("ruleHours").map(String),
    rulePct: formData.getAll("rulePct").map(String),
  };
}

function validate(v: PolicyFormState["values"]): FieldErrors {
  const e: FieldErrors = {};
  if (!v.name) e.name = "Required";
  const g = Number(v.gracePeriodMinutes);
  if (!Number.isInteger(g) || g < 0) e.grace = "Whole number of minutes, 0 or more";
  for (let i = 0; i < v.ruleHours.length; i++) {
    const h = Number(v.ruleHours[i]);
    const p = Number(v.rulePct[i]);
    if (!Number.isFinite(h) || h < 0) { e.rules = "Hours must be 0 or more"; break; }
    if (!Number.isFinite(p) || p < 0 || p > 100) { e.rules = "Refund % must be 0–100"; break; }
  }
  return e;
}

function toRules(v: PolicyFormState["values"]) {
  const out: { hoursBeforeStart: number; refundPctBps: number }[] = [];
  for (let i = 0; i < v.ruleHours.length; i++) {
    if (v.ruleHours[i] === "" && v.rulePct[i] === "") continue;
    out.push({
      hoursBeforeStart: Math.round(Number(v.ruleHours[i] || "0")),
      refundPctBps: Math.round(Number(v.rulePct[i] || "0") * 100),
    });
  }
  return out;
}

async function applyDefault(locationId: string, policyId: string) {
  const db = getDb();
  await db
    .update(cancellationPolicies)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(eq(cancellationPolicies.locationId, locationId));
  await db
    .update(cancellationPolicies)
    .set({ isDefault: true, updatedAt: new Date() })
    .where(eq(cancellationPolicies.id, policyId));
  await db
    .update(locations)
    .set({ cancellationPolicyId: policyId, updatedAt: new Date() })
    .where(eq(locations.id, locationId));
}

export async function createPolicy(
  slug: string,
  _prev: PolicyFormState | null,
  formData: FormData,
): Promise<PolicyFormState> {
  const values = parse(formData);
  const errors = validate(values);
  if (Object.keys(errors).length) return { ok: false, errors, values };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, errors: { form: "Location not found" }, values };
  const db = getDb();
  const policy = (
    await db
      .insert(cancellationPolicies)
      .values({
        locationId: location.id,
        name: values.name,
        gracePeriodMinutes: Number(values.gracePeriodMinutes || "0"),
        isDefault: false,
      })
      .returning()
  )[0];
  const rules = toRules(values);
  if (rules.length)
    await db.insert(cancellationPolicyRules).values(rules.map((r) => ({ policyId: policy.id, ...r })));
  if (values.isDefault) await applyDefault(location.id, policy.id);
  await recordAudit({ slug, action: "catalog.cancellation.create", summary: `Created cancellation policy "${values.name}"`, payload: { policyId: policy.id } });
  revalidatePath(`/locations/${slug}/catalog/cancellation`);
  redirect(`/locations/${slug}/catalog/cancellation`);
}

export async function updatePolicy(
  slug: string,
  id: string,
  _prev: PolicyFormState | null,
  formData: FormData,
): Promise<PolicyFormState> {
  const values = parse(formData);
  const errors = validate(values);
  if (Object.keys(errors).length) return { ok: false, errors, values };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, errors: { form: "Location not found" }, values };
  const db = getDb();
  const existing = (
    await db.select().from(cancellationPolicies).where(and(eq(cancellationPolicies.id, id), eq(cancellationPolicies.locationId, location.id))).limit(1)
  )[0];
  if (!existing) return { ok: false, errors: { form: "Not found" }, values };
  await db
    .update(cancellationPolicies)
    .set({ name: values.name, gracePeriodMinutes: Number(values.gracePeriodMinutes || "0"), updatedAt: new Date() })
    .where(eq(cancellationPolicies.id, id));
  await db.delete(cancellationPolicyRules).where(eq(cancellationPolicyRules.policyId, id));
  const rules = toRules(values);
  if (rules.length)
    await db.insert(cancellationPolicyRules).values(rules.map((r) => ({ policyId: id, ...r })));
  if (values.isDefault) await applyDefault(location.id, id);
  await recordAudit({ slug, action: "catalog.cancellation.update", summary: `Updated cancellation policy "${values.name}"`, payload: { policyId: id } });
  revalidatePath(`/locations/${slug}/catalog/cancellation`);
  redirect(`/locations/${slug}/catalog/cancellation`);
}

export async function deletePolicy(
  slug: string,
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };
  const db = getDb();
  if (location.cancellationPolicyId === id)
    return { ok: false, error: "Can't delete the location's default policy" };
  await db.delete(cancellationPolicyRules).where(eq(cancellationPolicyRules.policyId, id));
  await db.delete(cancellationPolicies).where(and(eq(cancellationPolicies.id, id), eq(cancellationPolicies.locationId, location.id)));
  await recordAudit({ slug, action: "catalog.cancellation.delete", summary: "Deleted a cancellation policy", payload: { id } });
  revalidatePath(`/locations/${slug}/catalog/cancellation`);
  return { ok: true };
}

"use server";
import { denyIfCannot } from "@/lib/auth/roles";

import { and, eq, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { recordAudit } from "@/lib/audit";
import { getDb, resourceRequirements, resources } from "@/lib/db";
import { getLocationBySlug } from "@/lib/data/locations";

type FieldErrors = Partial<
  Record<"name" | "maxConcurrentUses" | "outOfServiceCount" | "form", string>
>;

export type ResourceFormState = {
  ok: boolean;
  errors: FieldErrors;
  values: {
    name: string;
    maxConcurrentUses: string;
    outOfServiceCount: string;
  };
};

const MAX_NAME_LEN = 64;

function parseFormData(formData: FormData): ResourceFormState["values"] {
  return {
    name: String(formData.get("name") ?? "").trim(),
    maxConcurrentUses: String(formData.get("maxConcurrentUses") ?? "").trim(),
    outOfServiceCount: String(formData.get("outOfServiceCount") ?? "0").trim(),
  };
}

function validate(values: ResourceFormState["values"]): FieldErrors {
  const errors: FieldErrors = {};

  if (!values.name) errors.name = "Required";
  else if (values.name.length > MAX_NAME_LEN)
    errors.name = `Keep under ${MAX_NAME_LEN} characters`;

  const max = Number(values.maxConcurrentUses);
  if (!values.maxConcurrentUses) errors.maxConcurrentUses = "Required";
  else if (!Number.isInteger(max) || max < 1)
    errors.maxConcurrentUses = "Whole number, at least 1";
  else if (max > 100_000)
    errors.maxConcurrentUses = "That seems too high — double check";

  const oos = Number(values.outOfServiceCount || "0");
  if (!Number.isInteger(oos) || oos < 0)
    errors.outOfServiceCount = "Whole number, 0 or more";
  else if (Number.isInteger(max) && oos > max)
    errors.outOfServiceCount = "Can't exceed the max concurrent uses";

  return errors;
}

async function nextSortOrder(locationId: string): Promise<number> {
  const db = getDb();
  const result = await db
    .select({ max: max(resources.sortOrder) })
    .from(resources)
    .where(eq(resources.locationId, locationId));
  return (result[0]?.max ?? -1) + 1;
}

export async function createResource(
  slug: string,
  _prev: ResourceFormState | null,
  formData: FormData,
): Promise<ResourceFormState> {
  const values = parseFormData(formData);
  const errors = validate(values);
  if (Object.keys(errors).length > 0) return { ok: false, errors, values };

  const deny = await denyIfCannot("manage_config", slug);
  if (deny) return { ok: false, errors: { form: deny }, values };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, errors: { form: "Location not found" }, values };

  const db = getDb();
  const sortOrder = await nextSortOrder(location.id);

  try {
    await db.insert(resources).values({
      locationId: location.id,
      name: values.name,
      maxConcurrentUses: Number(values.maxConcurrentUses),
      outOfServiceCount: Number(values.outOfServiceCount || "0"),
      sortOrder,
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes("resources_location_name_idx")) {
      return {
        ok: false,
        errors: { name: "A resource with that name already exists" },
        values,
      };
    }
    throw err;
  }

  await recordAudit({
    slug,
    action: "catalog.resource.create",
    summary: `Created resource "${values.name}"`,
    payload: {
      name: values.name,
      maxConcurrentUses: Number(values.maxConcurrentUses),
    },
  });

  revalidatePath(`/locations/${slug}/catalog/resources`);
  redirect(`/locations/${slug}/catalog/resources`);
}

export async function updateResource(
  slug: string,
  id: string,
  _prev: ResourceFormState | null,
  formData: FormData,
): Promise<ResourceFormState> {
  const values = parseFormData(formData);
  const errors = validate(values);
  if (Object.keys(errors).length > 0) return { ok: false, errors, values };

  const deny = await denyIfCannot("manage_config", slug);
  if (deny) return { ok: false, errors: { form: deny }, values };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, errors: { form: "Location not found" }, values };

  const db = getDb();
  try {
    const result = await db
      .update(resources)
      .set({
        name: values.name,
        maxConcurrentUses: Number(values.maxConcurrentUses),
        outOfServiceCount: Number(values.outOfServiceCount || "0"),
        updatedAt: new Date(),
      })
      .where(
        and(eq(resources.id, id), eq(resources.locationId, location.id)),
      )
      .returning({ id: resources.id });

    if (result.length === 0) {
      return { ok: false, errors: { form: "Resource not found" }, values };
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("resources_location_name_idx")) {
      return {
        ok: false,
        errors: { name: "A resource with that name already exists" },
        values,
      };
    }
    throw err;
  }

  await recordAudit({
    slug,
    action: "catalog.resource.update",
    summary: `Updated resource "${values.name}"`,
    payload: { id },
  });

  revalidatePath(`/locations/${slug}/catalog/resources`);
  redirect(`/locations/${slug}/catalog/resources`);
}

export async function deleteResource(
  slug: string,
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const deny = await denyIfCannot("manage_config", slug);
  if (deny) return { ok: false, error: deny };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };

  const db = getDb();
  const inUse = await db
    .select({ id: resourceRequirements.id })
    .from(resourceRequirements)
    .where(eq(resourceRequirements.resourceId, id))
    .limit(1);

  if (inUse.length > 0) {
    return {
      ok: false,
      error: "Resource is in use by one or more tours. Remove it from their requirements first.",
    };
  }

  const before = await db
    .select({ name: resources.name })
    .from(resources)
    .where(and(eq(resources.id, id), eq(resources.locationId, location.id)))
    .limit(1);

  await db
    .delete(resources)
    .where(and(eq(resources.id, id), eq(resources.locationId, location.id)));

  await recordAudit({
    slug,
    action: "catalog.resource.delete",
    summary: `Deleted resource "${before[0]?.name ?? id}"`,
    payload: { id },
  });

  revalidatePath(`/locations/${slug}/catalog/resources`);
  return { ok: true };
}

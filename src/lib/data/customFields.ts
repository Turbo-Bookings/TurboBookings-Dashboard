import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { customFields, getDb, itemCustomFields } from "@/lib/db";
import type { CustomField } from "@/lib/db/schema";

export async function listCustomFields(
  locationId: string,
): Promise<CustomField[]> {
  const db = getDb();
  return db
    .select()
    .from(customFields)
    .where(and(eq(customFields.locationId, locationId), eq(customFields.archived, false)))
    .orderBy(asc(customFields.sortOrder), asc(customFields.label));
}

// Whole-booking custom fields attached to a tour (acknowledgments, add-ons,
// notes) — shown once per booking on the operator + customer booking forms.
export async function getWholeBookingFieldsForItem(
  itemId: string,
): Promise<CustomField[]> {
  const db = getDb();
  const rows = await db
    .select({ f: customFields })
    .from(itemCustomFields)
    .innerJoin(customFields, eq(itemCustomFields.customFieldId, customFields.id))
    .where(
      and(
        eq(itemCustomFields.itemId, itemId),
        eq(itemCustomFields.attachLevel, "whole_booking"),
        eq(customFields.archived, false),
      ),
    )
    .orderBy(asc(itemCustomFields.sortOrder), asc(customFields.label));
  return rows.map((r) => r.f);
}

export async function getCustomField(
  id: string,
  locationId: string,
): Promise<{ field: CustomField; attachedItemIds: string[] } | null> {
  const db = getDb();
  const field = (
    await db.select().from(customFields).where(eq(customFields.id, id)).limit(1)
  )[0];
  if (!field || field.locationId !== locationId) return null;
  const attached = await db
    .select({ itemId: itemCustomFields.itemId })
    .from(itemCustomFields)
    .where(eq(itemCustomFields.customFieldId, id));
  return { field, attachedItemIds: [...new Set(attached.map((a) => a.itemId))] };
}

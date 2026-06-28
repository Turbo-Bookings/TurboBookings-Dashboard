import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { discountCodes, getDb } from "@/lib/db";
import type { DiscountCode } from "@/lib/db/schema";

export async function listDiscountCodes(
  locationId: string,
): Promise<DiscountCode[]> {
  const db = getDb();
  return db
    .select()
    .from(discountCodes)
    .where(eq(discountCodes.locationId, locationId))
    .orderBy(asc(discountCodes.code));
}

export async function getDiscountCode(
  id: string,
  locationId: string,
): Promise<DiscountCode | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(discountCodes)
    .where(and(eq(discountCodes.id, id), eq(discountCodes.locationId, locationId)))
    .limit(1);
  return rows[0] ?? null;
}

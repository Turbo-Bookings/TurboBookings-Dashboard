import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { customerTypes, getDb, itemCustomerTypes, items } from "@/lib/db";
import type {
  CustomerType,
  Item,
  ItemCustomerType,
} from "@/lib/db/schema";

// Per-location items (tours, products). Joined with item_customer_types when
// the list view needs pricing summary.

export type ItemWithPricingSummary = Item & {
  customerTypeCount: number;
  minPriceCents: number | null;
  maxPriceCents: number | null;
};

export async function listItemsWithPricingSummary(
  locationId: string,
): Promise<ItemWithPricingSummary[]> {
  const db = getDb();
  const itemRows = await db
    .select()
    .from(items)
    .where(eq(items.locationId, locationId))
    .orderBy(asc(items.sortOrder), asc(items.createdAt));

  if (itemRows.length === 0) return [];

  const itemIds = itemRows.map((r) => r.id);
  const ictRows = await db
    .select()
    .from(itemCustomerTypes)
    .where(inArray(itemCustomerTypes.itemId, itemIds));

  const byItem = new Map<string, ItemCustomerType[]>();
  for (const row of ictRows) {
    const list = byItem.get(row.itemId) ?? [];
    list.push(row);
    byItem.set(row.itemId, list);
  }

  return itemRows.map((item) => {
    const lines = byItem.get(item.id) ?? [];
    const prices = lines.map((l) => l.priceCents);
    return {
      ...item,
      customerTypeCount: lines.length,
      minPriceCents: prices.length ? Math.min(...prices) : null,
      maxPriceCents: prices.length ? Math.max(...prices) : null,
    };
  });
}

export async function getItemById(
  id: string,
  locationId: string,
): Promise<Item | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(items)
    .where(eq(items.id, id))
    .limit(1);
  const row = rows[0];
  if (!row || row.locationId !== locationId) return null;
  return row;
}

export type ItemCustomerTypeWithLabel = ItemCustomerType & {
  customerTypeSingular: string;
  customerTypePlural: string;
  customerTypeArchived: boolean;
  customerTypeColor: string | null;
};

export async function getItemPricing(
  itemId: string,
): Promise<ItemCustomerTypeWithLabel[]> {
  const db = getDb();
  const rows = await db
    .select({
      ict: itemCustomerTypes,
      ct: customerTypes,
    })
    .from(itemCustomerTypes)
    .innerJoin(
      customerTypes,
      eq(itemCustomerTypes.customerTypeId, customerTypes.id),
    )
    .where(eq(itemCustomerTypes.itemId, itemId))
    .orderBy(asc(itemCustomerTypes.sortOrder), asc(customerTypes.sortOrder));

  return rows.map(({ ict, ct }) => ({
    ...ict,
    customerTypeSingular: ct.singular,
    customerTypePlural: ct.plural,
    customerTypeArchived: ct.archived,
    customerTypeColor: ct.ticketColor,
  }));
}

// Customer types in this location that aren't yet attached to the given item.
// Used to populate the "Add customer type" dropdown on the pricing matrix.
export async function getCustomerTypesNotInItem(
  itemId: string,
  locationId: string,
): Promise<CustomerType[]> {
  const db = getDb();
  const attached = await db
    .select({ id: itemCustomerTypes.customerTypeId })
    .from(itemCustomerTypes)
    .where(eq(itemCustomerTypes.itemId, itemId));
  const attachedIds = new Set(attached.map((r) => r.id));

  const all = await db
    .select()
    .from(customerTypes)
    .where(eq(customerTypes.locationId, locationId))
    .orderBy(asc(customerTypes.sortOrder));

  return all.filter((ct) => !ct.archived && !attachedIds.has(ct.id));
}

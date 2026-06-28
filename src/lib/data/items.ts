import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import {
  customerTypes,
  getDb,
  itemCustomerTypes,
  items,
  resourceRequirements,
  resources,
} from "@/lib/db";
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

// Lightweight item list for dropdowns (e.g. the schedule builder's tour
// picker). defaultDurationMinutes lets the form pre-fill a slot duration;
// capacityMode tells the schedule form whether to ask for a capacity number.
export type ItemForSelect = {
  id: string;
  name: string;
  defaultDurationMinutes: number;
  capacityMode: Item["capacityMode"];
  bookableOnline: boolean;
};

export async function listItemsForSelect(
  locationId: string,
): Promise<ItemForSelect[]> {
  const db = getDb();
  return db
    .select({
      id: items.id,
      name: items.name,
      defaultDurationMinutes: items.defaultDurationMinutes,
      capacityMode: items.capacityMode,
      bookableOnline: items.bookableOnline,
    })
    .from(items)
    .where(eq(items.locationId, locationId))
    .orderBy(asc(items.sortOrder), asc(items.createdAt));
}

// Resource pools each tour consumes (deduped by resource), for showing
// "capacity limited by ATVs (30)…" on resource-based tours. Keyed by item id.
export type ResourceSummary = { name: string; maxConcurrentUses: number };

export async function getResourceSummariesByItem(
  locationId: string,
): Promise<Record<string, ResourceSummary[]>> {
  const db = getDb();
  const rows = await db
    .select({
      itemId: resourceRequirements.itemId,
      name: resources.name,
      maxConcurrentUses: resources.maxConcurrentUses,
    })
    .from(resourceRequirements)
    .innerJoin(resources, eq(resourceRequirements.resourceId, resources.id))
    .innerJoin(items, eq(resourceRequirements.itemId, items.id))
    .where(eq(items.locationId, locationId));

  const out: Record<string, ResourceSummary[]> = {};
  for (const r of rows) {
    const list = out[r.itemId] ?? (out[r.itemId] = []);
    if (!list.some((x) => x.name === r.name))
      list.push({ name: r.name, maxConcurrentUses: r.maxConcurrentUses });
  }
  return out;
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

// ---------- Resource requirements matrix ----------
// Rows = customer types attached to the tour (via item_customer_types).
// Columns = the location's resource pools. Each cell = how many of that
// resource one unit of (tour × customer type) consumes. Feeds slot-capacity
// math: a slot stays bookable until any required resource is exhausted.

export type ResourceRowCustomerType = {
  customerTypeId: string;
  singular: string;
  ticketColor: string | null;
  archived: boolean;
};

export type ResourceColumn = {
  id: string;
  name: string;
  maxConcurrentUses: number;
};

export type ResourceRequirementCell = {
  customerTypeId: string;
  resourceId: string;
  quantityConsumed: number;
};

export type ItemResourceMatrix = {
  customerTypes: ResourceRowCustomerType[];
  resources: ResourceColumn[];
  cells: ResourceRequirementCell[];
};

export async function getItemResourceMatrix(
  itemId: string,
): Promise<ItemResourceMatrix> {
  const db = getDb();

  const ctRows = await db
    .select({ ct: customerTypes })
    .from(itemCustomerTypes)
    .innerJoin(
      customerTypes,
      eq(itemCustomerTypes.customerTypeId, customerTypes.id),
    )
    .where(eq(itemCustomerTypes.itemId, itemId))
    .orderBy(asc(itemCustomerTypes.sortOrder), asc(customerTypes.sortOrder));

  // Resources scoped to the same location as the item's customer types.
  const locationId = ctRows[0]?.ct.locationId;
  const resourceRows = locationId
    ? await db
        .select()
        .from(resources)
        .where(eq(resources.locationId, locationId))
        .orderBy(asc(resources.sortOrder), asc(resources.createdAt))
    : [];

  const reqRows = await db
    .select()
    .from(resourceRequirements)
    .where(eq(resourceRequirements.itemId, itemId));

  return {
    customerTypes: ctRows.map(({ ct }) => ({
      customerTypeId: ct.id,
      singular: ct.singular,
      ticketColor: ct.ticketColor,
      archived: ct.archived,
    })),
    resources: resourceRows.map((r) => ({
      id: r.id,
      name: r.name,
      maxConcurrentUses: r.maxConcurrentUses,
    })),
    cells: reqRows.map((r) => ({
      customerTypeId: r.customerTypeId,
      resourceId: r.resourceId,
      quantityConsumed: r.quantityConsumed,
    })),
  };
}

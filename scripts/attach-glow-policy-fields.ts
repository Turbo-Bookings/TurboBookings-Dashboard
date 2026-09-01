/**
 * Attach Dallas's four policy acknowledgements to the Night ATV Glow Tour.
 *
 * The glow tour was created by `scripts/create-dtown-glow-tour.ts`, which writes the item, its
 * pricing and its resource requirements — but no `item_custom_fields`. Neither does
 * `add-htown-tours.ts`. Houston's checkboxes were attached by hand in the admin UI afterwards;
 * nobody did that for Dallas.
 *
 * This is not a cosmetic gap. `getCheckoutFieldsForItem` returns nothing, the checkout renders
 * nothing (`{questions.length > 0 && ...}`), and the SERVER validates against the same empty list —
 * so every Dallas glow booking taken so far was completed without the customer ever being asked to
 * accept the Damage, Late, Refund or Pricing policy. The acknowledgement was not hidden; it was
 * never collected.
 *
 *   npx tsx scripts/attach-glow-policy-fields.ts            # dry run, prints the plan
 *   npx tsx scripts/attach-glow-policy-fields.ts --commit
 *
 * Deliberately NOT done through the admin UI. The only writer there is `setFieldAttachments`
 * (src/lib/actions/customFields.ts:142), which DELETES every attachment of a field across all tours
 * and re-inserts the submitted set. Ticking one box on one field detaches it from the day tour
 * unless every existing tour is re-ticked at the same time — four chances to silently strip the day
 * tour's own acknowledgements while trying to add the glow tour's.
 *
 * Works by CLONING the day tour's rows rather than composing new ones, so attach_level, sort_order
 * and customer_type_id come across exactly and the two tours cannot drift in field order.
 *
 * Idempotent: skips any (item, field) pair that already exists.
 */
import { readFileSync } from "node:fs";
import { and, eq, inArray } from "drizzle-orm";
import { withTxn, type Tx } from "../src/lib/db/pool";
import { customFields, itemCustomFields, items, locations } from "../src/lib/db/schema";

// Same env loading as scripts/check-inventory-snapshot.ts.
for (const f of [".env.production.local", ".env.local"]) {
  try {
    const raw = readFileSync(f, "utf8");
    for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"]) {
      const m = raw.match(new RegExp(`^${key}="?([^"\\n]+)"?`, "m"));
      if (m?.[1] && !process.env[key]) process.env[key] = m[1];
    }
  } catch {}
}

const COMMIT = process.argv.includes("--commit");
const SLUG = "dtown";
const SOURCE_TOUR = "D-Town ATV Tour"; // the tour whose acknowledgements are correct
const TARGET_TOUR = "Night ATV Glow Tour"; // the tour missing them

async function run(tx: Tx) {
  const loc = (
    await tx.select({ id: locations.id }).from(locations).where(eq(locations.slug, SLUG)).limit(1)
  )[0];
  if (!loc) throw new Error(`location "${SLUG}" not found`);

  const found = await tx
    .select({ id: items.id, name: items.name })
    .from(items)
    .where(and(eq(items.locationId, loc.id), inArray(items.name, [SOURCE_TOUR, TARGET_TOUR])));
  const source = found.find((i) => i.name === SOURCE_TOUR);
  const target = found.find((i) => i.name === TARGET_TOUR);
  if (!source) throw new Error(`tour "${SOURCE_TOUR}" not found at ${SLUG}`);
  if (!target) throw new Error(`tour "${TARGET_TOUR}" not found at ${SLUG}`);

  const sourceRows = await tx
    .select({
      customFieldId: itemCustomFields.customFieldId,
      attachLevel: itemCustomFields.attachLevel,
      customerTypeId: itemCustomFields.customerTypeId,
      sortOrder: itemCustomFields.sortOrder,
      label: customFields.label,
      kind: customFields.kind,
      required: customFields.required,
      archived: customFields.archived,
    })
    .from(itemCustomFields)
    .innerJoin(customFields, eq(customFields.id, itemCustomFields.customFieldId))
    .where(eq(itemCustomFields.itemId, source.id));

  if (sourceRows.length === 0)
    throw new Error(`"${SOURCE_TOUR}" has no custom fields to copy — nothing to do, check by hand`);

  const existing = new Set(
    (
      await tx
        .select({ customFieldId: itemCustomFields.customFieldId })
        .from(itemCustomFields)
        .where(eq(itemCustomFields.itemId, target.id))
    ).map((r) => r.customFieldId),
  );

  console.log(`\n  SOURCE  "${source.name}" — ${sourceRows.length} field(s)`);
  for (const r of sourceRows)
    console.log(
      `    [${r.kind}] required=${r.required} archived=${r.archived} level=${r.attachLevel} sort=${r.sortOrder}  "${r.label}"`,
    );

  const toAdd = sourceRows.filter((r) => !existing.has(r.customFieldId));
  console.log(`\n  TARGET  "${target.name}" — ${existing.size} field(s) today`);
  if (toAdd.length === 0) {
    console.log(`    already has every field from "${source.name}" — nothing to do.`);
    return;
  }
  for (const r of toAdd) console.log(`    + attach  [${r.kind}] "${r.label}"`);

  // A non-required acknowledgement is not an acknowledgement. Surfaced rather than silently copied,
  // because the whole point of this fix is that the customer must actually be asked.
  const optional = toAdd.filter((r) => !r.required);
  if (optional.length)
    console.log(
      `\n  ⚠️  ${optional.length} of these are NOT required on the source tour: ${optional
        .map((o) => `"${o.label}"`)
        .join(", ")} — they will render but cannot block checkout.`,
    );

  if (!COMMIT) {
    console.log(`\n  dry run — nothing written. Re-run with --commit.\n`);
    return;
  }

  for (const r of toAdd) {
    await tx.insert(itemCustomFields).values({
      itemId: target.id,
      customFieldId: r.customFieldId,
      attachLevel: r.attachLevel,
      customerTypeId: r.customerTypeId,
      sortOrder: r.sortOrder,
    });
  }

  const after = await tx
    .select({ label: customFields.label, kind: customFields.kind, required: customFields.required })
    .from(itemCustomFields)
    .innerJoin(customFields, eq(customFields.id, itemCustomFields.customFieldId))
    .where(eq(itemCustomFields.itemId, target.id))
    .orderBy(itemCustomFields.sortOrder);
  console.log(`\n  COMMITTED — "${target.name}" now asks for:`);
  for (const r of after) console.log(`    [${r.kind}] required=${r.required}  "${r.label}"`);
}

async function main() {
  console.log(`\n=== ${SLUG}: copy policy acknowledgements onto "${TARGET_TOUR}" ===`);
  await withTxn(run);
  console.log("");
}

main().catch((e) => {
  console.error("\n  FAILED —", e instanceof Error ? e.message : e);
  console.error("  nothing was written (single transaction).\n");
  process.exit(1);
});

import Link from "next/link";
import { notFound } from "next/navigation";
import { AddCustomerTypeForm } from "@/components/AddCustomerTypeForm";
import { PricingMatrixEditor } from "@/components/PricingMatrixEditor";
import {
  addCustomerTypeToItem,
  removeCustomerTypeFromItem,
  saveItemPricing,
} from "@/lib/actions/items";
import {
  getCustomerTypesNotInItem,
  getItemById,
  getItemPricing,
} from "@/lib/data/items";
import { getLocationBySlug } from "@/lib/data/locations";

type Props = {
  params: Promise<{ slug: string; id: string }>;
};

export default async function PricingMatrixPage({ params }: Props) {
  const { slug, id } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();

  const item = await getItemById(id, loc.id);
  if (!item) notFound();

  const [pricing, available] = await Promise.all([
    getItemPricing(id),
    getCustomerTypesNotInItem(id, loc.id),
  ]);

  const initialRows = pricing.map((p) => ({
    id: p.id,
    customerTypeId: p.customerTypeId,
    customerTypeLabel: p.customerTypeSingular,
    customerTypeColor: p.customerTypeColor,
    customerTypeArchived: p.customerTypeArchived,
    priceDollars: (p.priceCents / 100).toFixed(2),
    taxRatePercent:
      p.taxRateBpsOverride != null ? (p.taxRateBpsOverride / 100).toString() : "",
    visibility: p.visibility,
    minQuantity: p.minQuantity.toString(),
    maxQuantity: p.maxQuantity != null ? p.maxQuantity.toString() : "",
  }));

  const saveAction = saveItemPricing.bind(null, slug, id);

  // Server action for the Add form — accepts FormData so it can be passed
  // directly as a form's action prop.
  async function addAction(formData: FormData) {
    "use server";
    const customerTypeId = String(formData.get("customerTypeId") ?? "");
    if (!customerTypeId) return;
    await addCustomerTypeToItem(slug, id, customerTypeId);
  }

  // Server action for the per-row Remove button. Takes the row's
  // customerTypeId since it's already known on the client.
  async function removeRowAction(customerTypeId: string) {
    "use server";
    await removeCustomerTypeFromItem(slug, id, customerTypeId);
  }

  return (
    <section>
      <div className="mb-4 flex items-center gap-2 text-xs text-zinc-500">
        <Link
          href={`/locations/${slug}/catalog/tours`}
          className="hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          Tours
        </Link>
        <span>/</span>
        <Link
          href={`/locations/${slug}/catalog/tours/${id}`}
          className="truncate hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          {item.name}
        </Link>
        <span>/</span>
        <span>Pricing</span>
      </div>
      <header className="mb-6 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Pricing matrix
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500">
            One row per customer type this tour offers. Tax override (per row)
            falls back to the location&apos;s tax rate when blank. Hidden rows
            can&apos;t be added via the public booking flow — useful for comp,
            affiliate, or group rates.
          </p>
        </div>
        <AddCustomerTypeForm available={available} addAction={addAction} />
      </header>

      <PricingMatrixEditor
        initialRows={initialRows}
        saveAction={saveAction}
        removeRowAction={removeRowAction}
      />
    </section>
  );
}

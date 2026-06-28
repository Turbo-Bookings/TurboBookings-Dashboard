import { notFound } from "next/navigation";
import { DiscountCodeForm } from "@/components/DiscountCodeForm";
import { createDiscountCode } from "@/lib/actions/discountCodes";
import { listItemsForSelect } from "@/lib/data/items";
import { getLocationBySlug } from "@/lib/data/locations";

type Props = { params: Promise<{ slug: string }> };

export default async function NewDiscountPage({ params }: Props) {
  const { slug } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();
  const items = await listItemsForSelect(loc.id);
  const action = createDiscountCode.bind(null, slug);

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        New discount code
      </h2>
      <DiscountCodeForm
        action={action}
        cancelHref={`/locations/${slug}/catalog/discounts`}
        items={items.map((i) => ({ id: i.id, name: i.name }))}
        submitLabel="Create discount"
      />
    </section>
  );
}

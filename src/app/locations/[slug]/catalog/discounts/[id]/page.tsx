import { notFound } from "next/navigation";
import { DeleteDiscountButton } from "@/components/DeleteDiscountButton";
import { DiscountCodeForm } from "@/components/DiscountCodeForm";
import { updateDiscountCode } from "@/lib/actions/discountCodes";
import { getDiscountCode } from "@/lib/data/discountCodes";
import { listItemsForSelect } from "@/lib/data/items";
import { getLocationBySlug } from "@/lib/data/locations";

type Props = { params: Promise<{ slug: string; id: string }> };

function dateInput(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export default async function EditDiscountPage({ params }: Props) {
  const { slug, id } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();
  const code = await getDiscountCode(id, loc.id);
  if (!code) notFound();
  const items = await listItemsForSelect(loc.id);
  const action = updateDiscountCode.bind(null, slug, id);

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Edit <span className="font-mono">{code.code}</span>
        </h2>
        <DeleteDiscountButton slug={slug} id={id} />
      </div>
      <DiscountCodeForm
        action={action}
        cancelHref={`/locations/${slug}/catalog/discounts`}
        items={items.map((i) => ({ id: i.id, name: i.name }))}
        initial={{
          code: code.code,
          amountKind: code.amountKind,
          amount: String(code.amountValue / 100),
          applyMode: code.applyMode,
          validDaysOfWeek: code.validDaysOfWeek,
          maxUses: code.maxUses ? String(code.maxUses) : "",
          active: code.active,
          validFrom: dateInput(code.validFrom),
          validUntil: dateInput(code.validUntil),
          appliesToItemIds: code.appliesToItemIds,
        }}
        submitLabel="Save changes"
      />
    </section>
  );
}

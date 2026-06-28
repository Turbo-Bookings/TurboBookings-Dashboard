import Link from "next/link";
import { notFound } from "next/navigation";
import { listCustomFields } from "@/lib/data/customFields";
import { getLocationBySlug } from "@/lib/data/locations";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  text: "Text",
  checkbox: "Checkbox",
  dropdown: "Dropdown",
  quantity: "Quantity",
};

type Props = { params: Promise<{ slug: string }> };

export default async function CustomFieldsPage({ params }: Props) {
  const { slug } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();
  const fields = await listCustomFields(loc.id);
  const base = `/locations/${slug}/catalog/custom-fields`;

  return (
    <section>
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Custom fields
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Extra questions / acknowledgments / add-ons collected at booking.
          </p>
        </div>
        <Link href={`${base}/new`} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
          New field
        </Link>
      </header>

      {fields.length === 0 ? (
        <p className="text-sm text-zinc-500">No custom fields yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {fields.map((f) => (
            <li key={f.id} className="flex items-center gap-4 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  <Link href={`${base}/${f.id}`} className="hover:underline">
                    {f.label}
                  </Link>
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {KIND_LABEL[f.kind] ?? f.kind}
                  {f.required ? " · required" : ""}
                  {f.kind === "quantity" && f.pricePerUnitCents
                    ? ` · $${(f.pricePerUnitCents / 100).toFixed(2)}/unit`
                    : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

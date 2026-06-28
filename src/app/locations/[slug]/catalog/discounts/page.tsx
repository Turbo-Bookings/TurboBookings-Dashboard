import Link from "next/link";
import { notFound } from "next/navigation";
import { listDiscountCodes } from "@/lib/data/discountCodes";
import { getLocationBySlug } from "@/lib/data/locations";

export const dynamic = "force-dynamic";

function amountLabel(kind: string, value: number): string {
  return kind === "percent" ? `${(value / 100).toFixed(0)}% off` : `$${(value / 100).toFixed(2)} off`;
}

type Props = { params: Promise<{ slug: string }> };

export default async function DiscountsPage({ params }: Props) {
  const { slug } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();
  const codes = await listDiscountCodes(loc.id);
  const base = `/locations/${slug}/catalog/discounts`;

  return (
    <section>
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Discount codes
          </h2>
          <p className="mt-1 text-sm text-zinc-500">Promo codes customers can apply at checkout.</p>
        </div>
        <Link href={`${base}/new`} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
          New discount
        </Link>
      </header>

      {codes.length === 0 ? (
        <p className="text-sm text-zinc-500">No discount codes yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {codes.map((c) => (
            <li key={c.id} className="flex items-center gap-4 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  <Link href={`${base}/${c.id}`} className="font-mono hover:underline">
                    {c.code}
                  </Link>{" "}
                  <span className="text-zinc-400">· {amountLabel(c.amountKind, c.amountValue)}</span>
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {c.usedCount} used{c.maxUses ? ` / ${c.maxUses}` : ""}
                  {c.appliesToItemIds.length > 0 ? ` · ${c.appliesToItemIds.length} tour(s)` : " · all tours"}
                </p>
              </div>
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${c.active ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"}`}>
                {c.active ? "active" : "inactive"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

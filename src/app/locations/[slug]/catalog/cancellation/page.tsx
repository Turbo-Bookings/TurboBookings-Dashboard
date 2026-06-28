import Link from "next/link";
import { notFound } from "next/navigation";
import { listPolicies } from "@/lib/data/cancellationPolicies";
import { getLocationBySlug } from "@/lib/data/locations";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export default async function CancellationPage({ params }: Props) {
  const { slug } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();
  const policies = await listPolicies(loc.id);
  const base = `/locations/${slug}/catalog/cancellation`;

  return (
    <section>
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Cancellation policies
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Refund rules applied when a booking is cancelled.
          </p>
        </div>
        <Link href={`${base}/new`} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
          New policy
        </Link>
      </header>

      {policies.length === 0 ? (
        <p className="text-sm text-zinc-500">No policies yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {policies.map((p) => (
            <li key={p.id} className="flex items-center gap-4 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  <Link href={`${base}/${p.id}`} className="hover:underline">
                    {p.name}
                  </Link>
                  {p.isDefault && (
                    <span className="ml-2 rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                      default
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {p.gracePeriodMinutes > 0 ? `${p.gracePeriodMinutes}m grace · ` : ""}
                  {p.rules.length
                    ? p.rules
                        .map((r) => `≥${r.hoursBeforeStart}h → ${(r.refundPctBps / 100).toFixed(0)}%`)
                        .join(", ")
                    : "no refund rules"}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

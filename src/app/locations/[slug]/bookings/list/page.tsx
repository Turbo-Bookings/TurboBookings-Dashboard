import Link from "next/link";
import { notFound } from "next/navigation";
import { listBookings } from "@/lib/data/bookings";
import { getLocationBySlug } from "@/lib/data/locations";

export const dynamic = "force-dynamic";

function usd(c: number): string {
  return (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const STATUS_BADGE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  cancelled: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  refunded: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
};

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ status?: string; q?: string }>;
};

export default async function BookingsListPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();

  const tz = loc.timezone ?? "America/Chicago";
  const rows = await listBookings(loc.id, { status: sp.status, q: sp.q });
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const base = `/locations/${slug}/bookings`;

  return (
    <section>
      <header className="mb-4">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          All bookings
        </h2>
      </header>

      <form className="mb-4 flex flex-wrap items-center gap-2" action={`${base}/list`}>
        <select
          name="status"
          defaultValue={sp.status ?? "all"}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="cancelled">Cancelled</option>
          <option value="refunded">Refunded</option>
        </select>
        <input
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Name, email, or #"
          className="w-56 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
          Filter
        </button>
      </form>

      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">No bookings match.</p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-4 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  <Link href={`${base}/${r.id}`} className="hover:underline">
                    #{r.displayNumber}
                  </Link>{" "}
                  · {r.customerName}
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {r.itemName} · {fmt.format(r.startsAt)} · {r.source}
                </p>
              </div>
              <span className="text-sm">{usd(r.totalCents)}</span>
              <span
                className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[r.status] ?? ""}`}
              >
                {r.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

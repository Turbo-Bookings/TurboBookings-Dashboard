import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/PageHeader";
import { listBookings } from "@/lib/data/bookings";
import { getLocationBySlug } from "@/lib/data/locations";
import { bookingTone } from "@/lib/ui/status";

export const dynamic = "force-dynamic";

function usd(c: number): string {
  return (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

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
      <PageHeader
        title="Bookings"
        description={`${rows.length} booking${rows.length === 1 ? "" : "s"}`}
        actions={
          <Link
            href={`${base}/new`}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" /> New booking
          </Link>
        }
      />

      <form className="mb-4 flex flex-wrap items-center gap-2" action={base}>
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
        <button className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900">
          Filter
        </button>
      </form>

      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">No bookings match.</p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
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
              <Badge tone={bookingTone(r.status)}>{r.status}</Badge>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { AppShell } from "@/components/AppShell";
import { LocationTabs } from "@/components/LocationTabs";
import { StatusBadge } from "@/components/StatusBadge";
import { getDb, locations } from "@/lib/db";

type Props = {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
};

async function getLocation(slug: string) {
  const db = getDb();
  const rows = await db.select().from(locations).where(eq(locations.slug, slug)).limit(1);
  return rows[0];
}

export default async function LocationLayout({ children, params }: Props) {
  const { slug } = await params;
  const loc = await getLocation(slug);
  if (!loc) notFound();

  return (
    <AppShell>
      <div className="mb-2 flex items-center gap-2 text-xs text-zinc-500">
        <Link href="/" className="hover:text-zinc-700 dark:hover:text-zinc-300">
          Locations
        </Link>
        <span>/</span>
        <span className="font-mono">{loc.slug}</span>
      </div>

      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {loc.brandDisplayName ?? loc.slug}
        </h1>
        <StatusBadge status={loc.status} />
      </div>

      <LocationTabs slug={loc.slug} />

      {children}
    </AppShell>
  );
}

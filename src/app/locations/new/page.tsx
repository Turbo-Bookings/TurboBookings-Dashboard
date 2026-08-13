import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { NewLocationForm } from "@/components/NewLocationForm";
import { canCreateLocation } from "@/lib/auth/roles";

// Creating a location is Turbo-team only (master/admin).
export default async function NewLocationPage() {
  if (!(await canCreateLocation())) notFound();
  return (
    <AppShell>
      <div className="mb-2 flex items-center gap-2 text-xs text-zinc-500">
        <Link href="/" className="hover:text-zinc-700 dark:hover:text-zinc-300">
          Locations
        </Link>
        <span>/</span>
        <span>New</span>
      </div>

      <h1 className="mb-2 text-2xl font-semibold tracking-tight">
        New location
      </h1>
      <p className="mb-8 max-w-2xl text-sm text-zinc-500">
        Start a fresh location record. Only a slug, city, and apex domain are
        required to create — every other field can be filled in over time from
        the location&apos;s tabs.
      </p>

      <div className="max-w-xl">
        <NewLocationForm />
      </div>
    </AppShell>
  );
}

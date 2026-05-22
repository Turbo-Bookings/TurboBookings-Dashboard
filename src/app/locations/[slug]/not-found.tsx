import Link from "next/link";
import { AppShell } from "@/components/AppShell";

export default function LocationNotFound() {
  return (
    <AppShell>
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Location not found
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          No location with that slug exists yet.
        </p>
        <Link
          href="/"
          className="mt-6 text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
        >
          ← Back to all locations
        </Link>
      </div>
    </AppShell>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SUB_TABS = [
  { label: "Manifest", segment: "" },
  { label: "All bookings", segment: "list" },
  { label: "New booking", segment: "new" },
  { label: "Reports", segment: "reports" },
];

export function BookingsSubNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  const base = `/locations/${slug}/bookings`;

  return (
    <nav className="mt-4 flex flex-wrap gap-1">
      {SUB_TABS.map((tab) => {
        const href = tab.segment ? `${base}/${tab.segment}` : base;
        const isActive =
          tab.segment === ""
            ? pathname === base
            : pathname.startsWith(href);
        return (
          <Link
            key={tab.segment}
            href={href}
            className={
              isActive
                ? "rounded-md bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                : "rounded-md px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            }
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

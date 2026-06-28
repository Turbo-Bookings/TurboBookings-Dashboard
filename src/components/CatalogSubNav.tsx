"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type SubTab = {
  label: string;
  segment: string;
  hint?: string;
};

// Booking-system catalog sub-nav. Each section maps to a group of related
// tables in the booking-system schema:
//   - Tours        → items + item_customer_types + resource_requirements
//   - Resources    → resources (capacity pools — ATVs, UTVs, etc.)
//   - Customer Types → customer_types (Single Rider, Double Rider, etc.)
//   - Schedule     → availability_schedules + availabilities
// Tour Catalog = the tours + their availability. Shared pools (Customer Types,
// Resources, Custom Fields, Discounts, Cancellation) now live under Settings ▸ Build.
const SUB_TABS: SubTab[] = [
  { label: "Tours", segment: "tours" },
  { label: "Schedule", segment: "schedule" },
];

type Props = {
  slug: string;
};

export function CatalogSubNav({ slug }: Props) {
  const pathname = usePathname();
  const base = `/locations/${slug}/catalog`;

  return (
    <nav className="mt-4 flex flex-wrap gap-1">
      {SUB_TABS.map((tab) => {
        const href = `${base}/${tab.segment}`;
        const isActive = pathname.startsWith(href);
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

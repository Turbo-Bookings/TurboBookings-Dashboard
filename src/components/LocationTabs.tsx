"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Tab = {
  label: string;
  /** Path segment under /locations/[slug]/, or "" for the index */
  segment: string;
};

// Order intentionally matches the plan's tab order in
// `~/.claude/plans/snazzy-jingling-squirrel.md`. Branding & Tours is the
// default landing because it's the most-edited tab during onboarding and the
// least-empty for `draft` locations.
const TABS: Tab[] = [
  { label: "Branding & Tours", segment: "" },
  { label: "Catalog", segment: "catalog" },
  { label: "Tracking", segment: "tracking" },
  { label: "Integrations", segment: "integrations" },
  { label: "Setup", segment: "setup" },
  { label: "Dashboard", segment: "dashboard" },
  { label: "Activity", segment: "activity" },
  { label: "Settings", segment: "settings" },
];

type Props = {
  slug: string;
};

export function LocationTabs({ slug }: Props) {
  const pathname = usePathname();
  const base = `/locations/${slug}`;

  return (
    <nav className="border-b border-zinc-200 dark:border-zinc-800">
      <div className="-mb-px flex gap-1 overflow-x-auto">
        {TABS.map((tab) => {
          const href = tab.segment ? `${base}/${tab.segment}` : base;
          // For the index tab, match must be exact. For sub-tabs, prefix match.
          const isActive = tab.segment
            ? pathname.startsWith(href)
            : pathname === base;
          return (
            <Link
              key={tab.segment || "index"}
              href={href}
              className={
                isActive
                  ? "border-b-2 border-blue-600 px-3 py-2.5 text-sm font-medium text-blue-600 dark:border-blue-400 dark:text-blue-400"
                  : "border-b-2 border-transparent px-3 py-2.5 text-sm font-medium text-zinc-500 transition-colors hover:border-zinc-300 hover:text-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:text-zinc-200"
              }
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

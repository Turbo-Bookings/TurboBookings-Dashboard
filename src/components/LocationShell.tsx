"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { SearchBookings } from "@/components/SearchBookings";
import {
  BarChart3,
  ClipboardList,
  LayoutDashboard,
  type LucideIcon,
  Map,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings as SettingsIcon,
  Ticket,
  X,
} from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import type { Location } from "@/lib/db/schema";

type NavItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  href: (base: string) => string;
  match: (p: string, base: string) => boolean;
};

const BUILD_SEGMENTS = ["customer-types", "resources", "custom-fields", "cancellation", "discounts"];

function isBuildPath(p: string, base: string): boolean {
  return BUILD_SEGMENTS.some((s) => p.startsWith(`${base}/catalog/${s}`));
}

const NAV: NavItem[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    href: (b) => `${b}/dashboard`,
    match: (p, b) => p === `${b}/dashboard`,
  },
  {
    key: "bookings",
    label: "Bookings",
    icon: Ticket,
    href: (b) => `${b}/bookings`,
    match: (p, b) => p.startsWith(`${b}/bookings`),
  },
  {
    key: "manifest",
    label: "Manifest",
    icon: ClipboardList,
    href: (b) => `${b}/manifest`,
    match: (p, b) => p.startsWith(`${b}/manifest`),
  },
  {
    key: "reports",
    label: "Reports",
    icon: BarChart3,
    href: (b) => `${b}/reports`,
    match: (p, b) => p.startsWith(`${b}/reports`),
  },
  {
    key: "catalog",
    label: "Tour Catalog",
    icon: Map,
    href: (b) => `${b}/catalog/tours`,
    match: (p, b) =>
      p.startsWith(`${b}/catalog/tours`) ||
      p.startsWith(`${b}/catalog/schedule`) ||
      p === `${b}/catalog`,
  },
  {
    key: "settings",
    label: "Settings",
    icon: SettingsIcon,
    href: (b) => `${b}/settings`,
    match: (p, b) =>
      p.startsWith(`${b}/settings`) ||
      p.startsWith(`${b}/tracking`) ||
      p.startsWith(`${b}/integrations`) ||
      p.startsWith(`${b}/setup`) ||
      p.startsWith(`${b}/activity`) ||
      isBuildPath(p, b) ||
      p === b,
  },
];

type Props = {
  slug: string;
  brandName: string;
  status: Location["status"];
  locations: { slug: string; name: string; status: string }[];
  children: React.ReactNode;
};

export function LocationShell({ slug, brandName, status, locations, children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const base = `/locations/${slug}`;
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    // One-time sync of the collapse preference from localStorage after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapsed(localStorage.getItem("tb_sidebar_collapsed") === "1");
  }, []);

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem("tb_sidebar_collapsed", next ? "1" : "0");
      return next;
    });
  }

  const activeKey = NAV.find((n) => n.match(pathname, base))?.key ?? "";

  function NavLinks({ compact }: { compact: boolean }) {
    return (
      <nav className="flex flex-col gap-1 px-2">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = item.key === activeKey;
          return (
            <Link
              key={item.key}
              href={item.href(base)}
              title={compact ? item.label : undefined}
              onClick={() => setDrawerOpen(false)}
              className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              } ${compact ? "justify-center px-0" : ""}`}
            >
              <Icon className={`h-5 w-5 shrink-0 ${active ? "text-blue-600 dark:text-blue-400" : ""}`} />
              {!compact && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>
    );
  }

  function Switcher() {
    return (
      <select
        value={slug}
        onChange={(e) => router.push(`/locations/${e.target.value}/dashboard`)}
        className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm font-medium dark:border-zinc-700 dark:bg-zinc-900"
      >
        {locations.map((l) => (
          <option key={l.slug} value={l.slug}>
            {l.name}
          </option>
        ))}
      </select>
    );
  }

  const sidebarInner = (compact: boolean, inDrawer = false) => (
    <div className="flex h-full flex-col">
      <div className={`flex h-14 items-center ${compact ? "justify-center" : "justify-between"} px-3`}>
        {!compact && (
          <Link href="/" className="flex items-baseline gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">Turbo</span>
            <span className="text-sm font-semibold">Bookings</span>
          </Link>
        )}
        {inDrawer ? (
          <button onClick={() => setDrawerOpen(false)} className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <X className="h-5 w-5" />
          </button>
        ) : (
          <button
            onClick={toggleCollapsed}
            className="hidden rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 md:block dark:hover:bg-zinc-800"
            title={compact ? "Expand" : "Collapse"}
          >
            {compact ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
          </button>
        )}
      </div>

      {!compact && (
        <div className="px-3 pb-3">
          <Switcher />
        </div>
      )}

      <NavLinks compact={compact} />
      <div className="mt-auto" />
    </div>
  );

  return (
    <div className="flex min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* Desktop sidebar */}
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 border-r border-zinc-200 bg-white md:block print:hidden dark:border-zinc-800 dark:bg-zinc-900 ${
          collapsed ? "w-16" : "w-60"
        } transition-[width] duration-200`}
      >
        {sidebarInner(collapsed)}
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-64 border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            {sidebarInner(false, true)}
          </div>
        </div>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-zinc-200 bg-white/80 px-4 backdrop-blur md:px-8 print:hidden dark:border-zinc-800 dark:bg-zinc-950/80">
          <button
            onClick={() => setDrawerOpen(true)}
            className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 md:hidden dark:hover:bg-zinc-800"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold tracking-tight">{brandName}</span>
            <StatusBadge status={status} />
          </div>
          <div className="ml-auto flex items-center gap-3">
            <SearchBookings slug={slug} />
            <UserButton appearance={{ elements: { avatarBox: "h-8 w-8" } }} />
          </div>
        </header>
        <main className="flex-1 px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}

import Link from "next/link";
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

// Top-level chrome shared by every authenticated screen. Once Clerk is wired,
// the right side will host the user menu + location switcher.
export function AppShell({ children }: Props) {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="flex items-baseline gap-2">
            <span className="font-mono text-xs uppercase tracking-widest text-zinc-500">
              TurboBookings
            </span>
            <span className="text-sm font-semibold tracking-tight">
              Dashboard
            </span>
          </Link>
          {/* Reserved for Clerk user menu + location switcher */}
          <div className="text-xs text-zinc-400">Phase 1 · pre-auth</div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}

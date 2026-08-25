import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          {title}
        </h1>
        {description && <p className="mt-1 text-sm text-zinc-500">{description}</p>}
      </div>
      {/*
        `flex-wrap` is not optional here. The outer header wraps, but this inner row did not — so a
        page with several controls forced them onto one line and pushed the whole page wider than the
        screen. The bookings header carries five (prev, next, a date input, Recent, New booking),
        which does not fit on a phone, and a horizontally-scrolling dashboard is unusable at a desk
        with one hand on a clipboard.

        `justify-end` keeps the controls right-aligned when they do fit, so nothing moves on desktop.
      */}
      {actions && (
        <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>
      )}
    </header>
  );
}

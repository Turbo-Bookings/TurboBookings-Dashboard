"use client";

import { useActionState } from "react";
import { MarkdownField } from "@/components/MarkdownField";
import type { NotificationsState } from "@/lib/actions/locations";

export function NotificationsForm({
  action,
  initial,
}: {
  action: (
    prev: NotificationsState | null,
    formData: FormData,
  ) => Promise<NotificationsState>;
  initial: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const err = state && !state.ok ? state.error : undefined;

  return (
    <form action={formAction} className="max-w-2xl space-y-6">
      <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold">Booking-confirmation email</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Every completed booking sends a confirmation email. It&apos;s
          automatically branded with this location&apos;s logo, colors, name,
          and support contact — the <strong>From</strong> name is your brand and
          customer <strong>replies go to your support email</strong>. The
          optional message below appears near the bottom of every confirmation
          (e.g. arrival tips, a thank-you, directions).
        </p>
        <div className="mt-3">
          <MarkdownField
            name="confirmationMessage"
            label="Custom message (optional)"
            defaultValue={initial}
            error={err}
            rows={6}
            placeholder="e.g. See you on the trails! Arrive 15 minutes early and wear closed-toe shoes."
          />
        </div>
      </section>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {state?.ok && (
          <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
            ✓ Saved
          </span>
        )}
      </div>
    </form>
  );
}

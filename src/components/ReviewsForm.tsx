"use client";

import { useActionState } from "react";
import type { ReviewsState, ReviewsValues } from "@/lib/actions/locations";

const input =
  "mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const label = "block text-sm font-medium";
const errCls = "mt-1 text-xs font-medium text-red-600 dark:text-red-400";

export function ReviewsForm({
  action,
  initial,
}: {
  action: (prev: ReviewsState | null, formData: FormData) => Promise<ReviewsState>;
  initial: ReviewsValues;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const v = state?.values ?? initial;
  const err = state && !state.ok ? state.errors : {};

  return (
    <form action={formAction} className="max-w-lg space-y-6">
      <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold">Google reviews badge</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Shown on the customer tour page and checkout as social proof. Leave blank to hide the badge.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className={label} htmlFor="rating">Rating (0–5)</label>
            <input id="rating" name="rating" defaultValue={v.rating} placeholder="4.9" inputMode="decimal" className={input} />
            {err.rating && <p className={errCls}>{err.rating}</p>}
          </div>
          <div>
            <label className={label} htmlFor="count">Review count</label>
            <input id="count" name="count" defaultValue={v.count} placeholder="5135" inputMode="numeric" className={input} />
            {err.count && <p className={errCls}>{err.count}</p>}
          </div>
        </div>
        <div className="mt-3">
          <label className={label} htmlFor="url">Reviews link (optional)</label>
          <input id="url" name="url" defaultValue={v.url} placeholder="https://g.page/r/…" className={input} />
          {err.url && <p className={errCls}>{err.url}</p>}
          <p className="mt-1 text-xs text-zinc-500">Where the badge links (your Google reviews page).</p>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold">Write-a-review link</h2>
        <p className="mt-1 text-xs text-zinc-500">
          The button in your post-tour review email opens this link. Use a link
          that drops the customer straight into Google&apos;s review dialog.
        </p>
        <div className="mt-3">
          <label className={label} htmlFor="writeUrl">Write-a-review link (optional)</label>
          <input
            id="writeUrl"
            name="writeUrl"
            defaultValue={v.writeUrl}
            placeholder="https://g.page/r/…/review"
            className={input}
          />
          {err.writeUrl && <p className={errCls}>{err.writeUrl}</p>}
          <p className="mt-1 text-xs text-zinc-500">
            In your Google Business Profile, choose <strong>Ask for reviews</strong>{" "}
            (or <strong>Get more reviews</strong>) and copy the share link — it
            looks like <code>https://g.page/r/…/review</code>. Leave blank to fall
            back to the Reviews link above.
          </p>
        </div>
      </section>

      {err.form && <p className={errCls}>{err.form}</p>}
      {state?.ok && <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Saved.</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

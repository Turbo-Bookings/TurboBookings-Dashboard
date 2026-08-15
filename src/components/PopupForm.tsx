"use client";

import { useActionState } from "react";
import type { PopupState, PopupValues } from "@/lib/actions/popup";

const input =
  "mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const label = "block text-sm font-medium";

export function PopupForm({
  action,
  initial,
}: {
  action: (prev: PopupState | null, formData: FormData) => Promise<PopupState>;
  initial: PopupValues;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const v = state?.values ?? initial;

  return (
    <form action={formAction} className="max-w-lg space-y-6">
      <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <label className="flex items-center gap-3">
          <input type="checkbox" name="enabled" defaultChecked={v.enabled} className="h-4 w-4" />
          <span className="text-sm font-medium">Show the email-capture popup on the marketing site</span>
        </label>
        <p className="mt-1 text-xs text-zinc-500">
          Grows your list and lifts ad match quality. Edits go live within a minute — no redeploy.
        </p>
      </section>

      <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold">Content</h2>
        <div>
          <label className={label} htmlFor="offer">Eyebrow (optional)</label>
          <input id="offer" name="offer" defaultValue={v.offer} placeholder="LIMITED TIME" className={input} />
        </div>
        <div>
          <label className={label} htmlFor="headline">Headline</label>
          <input id="headline" name="headline" defaultValue={v.headline} className={input} />
        </div>
        <div>
          <label className={label} htmlFor="subhead">Subhead</label>
          <textarea id="subhead" name="subhead" defaultValue={v.subhead} rows={2} className={input} />
        </div>
        <div>
          <label className={label} htmlFor="buttonLabel">Button label</label>
          <input id="buttonLabel" name="buttonLabel" defaultValue={v.buttonLabel} className={input} />
        </div>
        <div>
          <label className={label} htmlFor="imageFile">Image (optional)</label>
          <p className="mt-0.5 text-xs text-zinc-500">
            A banner shown at the top of the popup. PNG/JPEG/WebP/GIF, up to 5 MB.
          </p>
          {v.imageUrl && (
            <div className="mt-2 flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={v.imageUrl} alt="Current popup image" className="h-16 w-28 rounded-md border border-zinc-200 object-cover dark:border-zinc-700" />
              <label className="flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-300">
                <input type="checkbox" name="removeImage" className="h-4 w-4" /> Remove image
              </label>
            </div>
          )}
          <input type="hidden" name="currentImageUrl" value={v.imageUrl} />
          <input
            id="imageFile"
            name="imageFile"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="mt-2 block w-full text-sm text-zinc-600 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-zinc-200 dark:text-zinc-300 dark:file:bg-zinc-800"
          />
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold">After they subscribe</h2>
        <div>
          <label className={label} htmlFor="successMessage">Success message</label>
          <textarea id="successMessage" name="successMessage" defaultValue={v.successMessage} rows={2} className={input} />
        </div>
        <div>
          <label className={label} htmlFor="incentiveCode">Discount code to reveal (optional)</label>
          <input id="incentiveCode" name="incentiveCode" defaultValue={v.incentiveCode} placeholder="RIDE10" className={input} />
          <p className="mt-1 text-xs text-zinc-500">Shown on the success screen. Set this up as a discount code in your catalog too.</p>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold">Timing</h2>
        <div>
          <label className={label} htmlFor="delaySeconds">Show after (seconds on page)</label>
          <input id="delaySeconds" name="delaySeconds" defaultValue={v.delaySeconds} inputMode="numeric" className={`${input} w-32`} />
        </div>
        <label className="flex items-center gap-3">
          <input type="checkbox" name="exitIntent" defaultChecked={v.exitIntent} className="h-4 w-4" />
          <span className="text-sm">Also show on exit intent (mouse leaves toward the tab bar)</span>
        </label>
        <div>
          <label className={label} htmlFor="suppressDays">Don’t show again for (days)</label>
          <input id="suppressDays" name="suppressDays" defaultValue={v.suppressDays} inputMode="numeric" className={`${input} w-32`} />
          <p className="mt-1 text-xs text-zinc-500">
            After someone closes the popup without signing up, hide it on their device for this many days.
            Anyone who has already subscribed never sees it again.
          </p>
        </div>
      </section>

      {state && !state.ok && <p className="text-xs font-medium text-red-600 dark:text-red-400">{state.error}</p>}
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

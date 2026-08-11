"use client";

import { useActionState, useMemo } from "react";
import { MarkdownField } from "@/components/MarkdownField";
import type {
  EditableEmailType,
  EmailTemplateState,
} from "@/lib/actions/locations";

export type EmailTemplateInitial = {
  type: EditableEmailType;
  enabled: boolean;
  subject: string;
  body: string;
  discountCodeId: string;
};

type ServerAction = (
  slug: string,
  type: EditableEmailType,
  prev: EmailTemplateState | null,
  formData: FormData,
) => Promise<EmailTemplateState>;

type Meta = {
  label: string;
  timing: string;
  description: string;
  subjectPlaceholder: string;
  bodyPlaceholder: string;
  marketing: boolean;
};

const TYPE_META: Record<EditableEmailType, Meta> = {
  reminder_24h: {
    label: "24-hour reminder",
    timing: "Sent 24 hours before the tour starts",
    description:
      "A heads-up the day before so guests don't forget and arrive on time.",
    subjectPlaceholder: "Reminder: your ride is tomorrow",
    bodyPlaceholder:
      "e.g. Can't wait to see you! Arrive 15 min early, wear closed-toe shoes.",
    marketing: false,
  },
  reminder_2h: {
    label: "2-hour reminder",
    timing: "Sent 2 hours before the tour starts",
    description: "A final nudge shortly before check-in.",
    subjectPlaceholder: "See you in 2 hours!",
    bodyPlaceholder: "e.g. We're getting the ATVs ready — head our way soon!",
    marketing: false,
  },
  abandoned_cart_1: {
    label: "Abandoned cart — 1st email",
    timing: "Sent 15 minutes after a cart is abandoned",
    description:
      "Nudges a shopper who entered their email but didn't finish checkout.",
    subjectPlaceholder: "You left your ride behind",
    bodyPlaceholder: "e.g. Your spot isn't booked yet — finish in one tap.",
    marketing: true,
  },
  abandoned_cart_2: {
    label: "Abandoned cart — 2nd email (with discount)",
    timing: "Sent 24 hours after a cart is abandoned",
    description:
      "A follow-up with a discount code to win back the booking. Pick the code below.",
    subjectPlaceholder: "Here's a little something to finish booking",
    bodyPlaceholder: "e.g. Still thinking it over? Use the code below to save.",
    marketing: true,
  },
  post_tour_review: {
    label: "Post-tour review request",
    timing: "Sent 3 hours after the tour ends",
    description:
      "Asks guests who checked in to leave a Google review. Requires a Google reviews URL in this location's settings.",
    subjectPlaceholder: "How was your ride?",
    bodyPlaceholder: "e.g. We'd love a quick review — it means the world to us!",
    marketing: true,
  },
  cancellation: {
    label: "Cancellation confirmation",
    timing: "Sent when a booking is cancelled",
    description: "Confirms the cancellation and any refund.",
    subjectPlaceholder: "Your booking has been cancelled",
    bodyPlaceholder: "e.g. Sorry to see you go — hope to ride with you soon.",
    marketing: false,
  },
  reschedule: {
    label: "Reschedule confirmation",
    timing: "Sent when a booking is moved to a new time",
    description: "Confirms the new date and time.",
    subjectPlaceholder: "Your booking has a new time",
    bodyPlaceholder: "e.g. All set for your new time — see you then!",
    marketing: false,
  },
};

export function EmailTemplatesEditor({
  slug,
  initial,
  discountCodes,
  action,
}: {
  slug: string;
  initial: EmailTemplateInitial[];
  discountCodes: { id: string; code: string }[];
  action: ServerAction;
}) {
  return (
    <div className="max-w-2xl space-y-4">
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        Lifecycle emails
      </h2>
      <p className="-mt-2 text-xs text-zinc-500">
        Reminders, cart recovery, review requests, and cancellation/reschedule
        confirmations. Edit the copy or turn any off. Send times are fixed.
      </p>
      {initial.map((t) => (
        <EmailTemplateCard
          key={t.type}
          slug={slug}
          initial={t}
          discountCodes={discountCodes}
          action={action}
        />
      ))}
    </div>
  );
}

function EmailTemplateCard({
  slug,
  initial,
  discountCodes,
  action,
}: {
  slug: string;
  initial: EmailTemplateInitial;
  discountCodes: { id: string; code: string }[];
  action: ServerAction;
}) {
  const meta = TYPE_META[initial.type];
  const bound = useMemo(
    () => action.bind(null, slug, initial.type),
    [action, slug, initial.type],
  );
  const [state, formAction, pending] = useActionState(bound, null);
  const err = state && !state.ok ? state.error : undefined;

  return (
    <form
      action={formAction}
      className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{meta.label}</h3>
            {meta.marketing && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400">
                Marketing
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-zinc-500">{meta.timing}</p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={initial.enabled}
            className="h-4 w-4"
          />
          Enabled
        </label>
      </div>

      <p className="mt-2 text-xs text-zinc-500">{meta.description}</p>

      <div className="mt-3">
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Subject line{" "}
          <span className="text-xs font-normal text-zinc-400">(optional)</span>
        </label>
        <input
          name="subject"
          defaultValue={initial.subject}
          placeholder={meta.subjectPlaceholder}
          maxLength={150}
          className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
      </div>

      <div className="mt-3">
        <MarkdownField
          name="body"
          label="Message"
          defaultValue={initial.body}
          rows={4}
          placeholder={meta.bodyPlaceholder}
        />
      </div>

      {initial.type === "abandoned_cart_2" && (
        <div className="mt-3">
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Discount code
          </label>
          <select
            name="discountCodeId"
            defaultValue={initial.discountCodeId}
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          >
            <option value="">No discount</option>
            {discountCodes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code}
              </option>
            ))}
          </select>
          {discountCodes.length === 0 && (
            <p className="mt-1 text-xs text-zinc-500">
              No active codes yet — create one under Catalog → Discounts.
            </p>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {state?.ok && (
          <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
            ✓ Saved
          </span>
        )}
        {err && (
          <span className="text-sm font-medium text-red-600 dark:text-red-400">
            {err}
          </span>
        )}
      </div>
    </form>
  );
}

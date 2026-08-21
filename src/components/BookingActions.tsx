"use client";

import { useState, useTransition } from "react";
import {
  cancelBooking,
  captureHold,
  placeHold,
  refundBookingOverride,
  releaseHold,
} from "@/lib/actions/bookings";
import { useCaps } from "@/components/CapabilitiesProvider";

function usd(c: number): string {
  return (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

type Hold = { id: string; status: string; amountCents: number };

type Props = {
  slug: string;
  bookingId: string;
  status: string;
  refundLabel: string;
  refundCents: number;
  /** Still refundable on Stripe payments — the ceiling for an override. */
  refundableCents: number;
  hasCardOnFile: boolean;
  holds: Hold[];
  onChanged?: () => void;
};

export function BookingActions({
  slug,
  bookingId,
  status,
  refundLabel,
  refundCents,
  refundableCents,
  hasCardOnFile,
  holds,
  onChanged,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [holdDollars, setHoldDollars] = useState("100");
  const [overrideDollars, setOverrideDollars] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideCancel, setOverrideCancel] = useState(true);
  const caps = useCaps();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Failed");
      else onChanged?.();
    });
  }

  const active = status === "active";

  return (
    <div className="mt-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Operator actions
      </h3>

      {/* Security holds */}
      <div className="mt-3">
        <p className="text-sm font-medium">Security hold</p>
        {holds.filter((h) => h.status === "authorized").length > 0 ? (
          <ul className="mt-1 space-y-1">
            {holds
              .filter((h) => h.status === "authorized")
              .map((h) => (
                <li key={h.id} className="flex items-center gap-2 text-sm">
                  <span>{usd(h.amountCents)} authorized</span>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => captureHold(slug, h.id))}
                    className="rounded-md border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    Capture
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => releaseHold(slug, h.id))}
                    className="rounded-md border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    Release
                  </button>
                </li>
              ))}
          </ul>
        ) : active ? (
          hasCardOnFile ? (
            <div className="mt-1 flex items-center gap-2">
              <span className="text-sm text-zinc-500">$</span>
              <input
                type="number"
                min={1}
                value={holdDollars}
                onChange={(e) => setHoldDollars(e.target.value)}
                className="w-20 rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(() =>
                    placeHold(slug, bookingId, Math.round(Number(holdDollars) * 100)),
                  )
                }
                className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Place hold
              </button>
            </div>
          ) : (
            <p className="mt-1 text-xs text-zinc-400">No card on file for this customer.</p>
          )
        ) : null}
      </div>

      {/* Cancel + refund */}
      {active && (
        <div className="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <p className="text-sm font-medium text-red-700 dark:text-red-400">
            Cancel booking
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            {refundLabel}
            {refundCents > 0 ? ` — ${usd(refundCents)} back to the customer.` : "."}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (optional)"
              className="w-56 rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (
                  window.confirm(
                    `Cancel booking and refund ${usd(refundCents)}? This can't be undone.`,
                  )
                )
                  run(() => cancelBooking(slug, bookingId, reason));
              }}
              className="rounded-md bg-red-600 px-3 py-1 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              Cancel booking
            </button>
          </div>
        </div>
      )}

      {/* Override refund — admin only.
          The policy figure above is the right default and the wrong answer for
          a goodwill refund, a weather call, an operator mistake or a test
          booking. Without this the only way to refund against policy is inside
          Stripe, where our own database never learns it happened. */}
      {caps.manage_platform && refundableCents > 0 && (
        <div className="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Refund a different amount
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Overrides the cancellation policy. {usd(refundableCents)} still
            refundable. The platform fee comes back too, prorated.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <div className="relative">
              <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-zinc-500">
                $
              </span>
              <input
                value={overrideDollars}
                onChange={(e) => setOverrideDollars(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                className="w-28 rounded-md border border-zinc-300 py-1 pl-5 pr-2 text-sm tabular-nums dark:border-zinc-700 dark:bg-zinc-900"
              />
            </div>
            <button
              type="button"
              onClick={() => setOverrideDollars((refundableCents / 100).toFixed(2))}
              className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Full ({usd(refundableCents)})
            </button>
            <input
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="Reason (required)"
              className="w-56 rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
          {active && (
            <label className="mt-2 flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={overrideCancel}
                onChange={(e) => setOverrideCancel(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              Also cancel this booking and free the slot
            </label>
          )}
          <button
            type="button"
            disabled={pending || !overrideReason.trim() || !(Number(overrideDollars) > 0)}
            onClick={() => {
              const cents = Math.round(Number(overrideDollars) * 100);
              if (!(cents > 0)) return;
              if (
                window.confirm(
                  `Refund ${usd(cents)}${
                    overrideCancel && active ? " and cancel the booking" : " and keep the booking active"
                  }? This can't be undone.`,
                )
              )
                run(() =>
                  refundBookingOverride(
                    slug,
                    bookingId,
                    cents,
                    overrideReason,
                    overrideCancel && active,
                  ),
                );
            }}
            className="mt-2 rounded-md border border-red-300 px-3 py-1 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
          >
            Refund {Number(overrideDollars) > 0 ? usd(Math.round(Number(overrideDollars) * 100)) : ""}
          </button>
        </div>
      )}

      {error && (
        <p className="mt-2 text-sm font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

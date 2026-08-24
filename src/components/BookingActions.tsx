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
  // Pre-filled with what the policy says. Staff can type over it; anything different is an override
  // and then a reason becomes mandatory, because an override leaves no policy trail to explain itself.
  const [amountDollars, setAmountDollars] = useState((refundCents / 100).toFixed(2));
  const caps = useCaps();

  const amountCents = Math.max(0, Math.round(Number(amountDollars) * 100));
  const isOverride = amountCents !== refundCents;

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

      {/* Cancel + refund — ONE flow.
          This used to be two: a loud red "Cancel booking" that paid out whatever the policy said,
          and a quieter "Refund a different amount" below it. On a booking outside the cancellation
          window the policy figure is $0.00, so the prominent button cancelled the booking and
          returned NOTHING while the correct action sat underneath in a weaker style — with its own
          separate reason field. The obvious button was the wrong one, and it kept the customer's
          money. Merged so there is a single amount, a single reason, and a button that states what
          it is about to do. */}
      {(active || refundableCents > 0) && (
        <div className="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <p className="text-sm font-medium text-red-700 dark:text-red-400">
            {active ? "Cancel booking" : "Refund"}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            {refundLabel}
            {refundableCents > 0
              ? ` · ${usd(refundableCents)} was paid and is still refundable.`
              : " · nothing left to refund."}
          </p>

          {refundableCents > 0 && caps.refund && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <div className="relative">
                <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-zinc-500">
                  $
                </span>
                <input
                  value={amountDollars}
                  onChange={(e) => setAmountDollars(e.target.value)}
                  inputMode="decimal"
                  className="w-28 rounded-md border border-zinc-300 py-1 pl-5 pr-2 text-sm tabular-nums dark:border-zinc-700 dark:bg-zinc-900"
                />
              </div>
              <button
                type="button"
                onClick={() => setAmountDollars((refundCents / 100).toFixed(2))}
                className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Policy ({usd(refundCents)})
              </button>
              <button
                type="button"
                onClick={() => setAmountDollars((refundableCents / 100).toFixed(2))}
                className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Full ({usd(refundableCents)})
              </button>
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={isOverride ? "Reason (required)" : "Reason (optional)"}
              className="w-56 rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>

          {!active && (
            <p className="mt-1 text-xs text-zinc-400">
              Already cancelled — this refunds only.
            </p>
          )}

          <button
            type="button"
            disabled={pending || (isOverride && !reason.trim())}
            onClick={() => {
              const cents = Math.max(0, Math.round(Number(amountDollars) * 100));
              // Say plainly what happens. "Cancel booking and refund $0.00?" is technically true and
              // reads like a formality; the risk is that the customer paid and gets nothing back.
              const msg =
                cents === 0 && refundableCents > 0
                  ? `Cancel this booking and refund NOTHING? The customer paid ${usd(refundableCents)} and it will not be returned.`
                  : active
                    ? `Refund ${usd(cents)} and cancel the booking? This can't be undone.`
                    : `Refund ${usd(cents)}? This can't be undone.`;
              if (!window.confirm(msg)) return;
              // A zero refund is a plain policy cancellation; the override action rejects amounts
              // of zero by design, so route it to the action that handles it.
              if (cents === 0) run(() => cancelBooking(slug, bookingId, reason));
              else run(() => refundBookingOverride(slug, bookingId, cents, reason, active));
            }}
            className="mt-2 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {active
              ? `Cancel booking${amountCents > 0 ? ` · refund ${usd(amountCents)}` : " · no refund"}`
              : `Refund ${usd(amountCents)}`}
          </button>
          {isOverride && !reason.trim() && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
              This differs from the policy amount, so a reason is required.
            </p>
          )}
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

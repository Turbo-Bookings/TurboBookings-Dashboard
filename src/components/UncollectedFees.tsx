"use client";

import { useState, useTransition } from "react";
import {
  billFeeToOperatorAction,
  retryFeeCharge,
  writeOffFee,
} from "@/lib/actions/uncollectedFees";
import type { UncollectedFee } from "@/lib/booking/platformFee";

const usd = (c: number) =>
  (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/**
 * Platform fee owed but not collected.
 *
 * The split that matters is not "can we charge a card" — it is **who owes it**, and the tour date
 * decides. Before the tour, the fee is still inside a balance the customer has not paid, so a retry
 * collects our share and drops their balance by the same amount. After it, the operator has already
 * taken that balance in cash and is holding our money; charging the card there bills the same money
 * twice, to the wrong person.
 *
 * So past-tour rows never offer Retry. They offer **Bill to operator**, which adds the amount to the
 * operator's next platform invoice — recovering it in-system instead of by a side conversation that
 * would have to repeat for every operator client we take on.
 *
 * FareHarbor imports never reach this list; they are written off on sight.
 */
export function UncollectedFees({
  slug,
  rows,
  retainerActive,
}: {
  slug: string;
  rows: UncollectedFee[];
  retainerActive: boolean;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const settled = rows.filter((r) => r.settledAtVenue);
  const upcoming = rows.filter((r) => !r.settledAtVenue);
  const total = rows.reduce((s, r) => s + r.amountCents, 0);
  const settledTotal = settled.reduce((s, r) => s + r.amountCents, 0);

  function act(id: string, fn: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    setMsg(null);
    setErr(null);
    setBusyId(id);
    start(async () => {
      const r = await fn();
      if (!r.ok) setErr(r.error ?? "Failed");
      else setMsg(done);
      setBusyId(null);
    });
  }

  if (rows.length === 0) {
    return (
      <p className="mt-4 text-sm text-zinc-500">
        Nothing outstanding — every platform fee has been collected, billed on, or written off.
      </p>
    );
  }

  const tourDate = (d: Date | null) =>
    d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "no date";

  const Row = ({ r }: { r: UncollectedFee }) => (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-100 py-2 text-sm last:border-0 dark:border-zinc-800">
      <span className="w-20 font-mono text-xs text-zinc-500">#{r.displayNumber}</span>
      <span className="w-20 font-semibold tabular-nums">{usd(r.amountCents)}</span>
      <span className="w-16 text-xs tabular-nums text-zinc-400">{tourDate(r.tourStartsAt)}</span>
      <span className="min-w-0 flex-1 truncate text-zinc-600 dark:text-zinc-300">
        {r.customerEmail ?? "—"}
        <span className="ml-2 text-xs text-zinc-400">{r.reason}</span>
      </span>

      {r.settledAtVenue ? (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            act(
              r.bookingId,
              () => billFeeToOperatorAction(slug, r.bookingId, "collected at the venue"),
              `${usd(r.amountCents)} added to the operator's next invoice.`,
            )
          }
          className="rounded-md border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {busyId === r.bookingId && pending ? "Adding…" : "Bill to operator"}
        </button>
      ) : (
        r.chaseable && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              act(
                r.bookingId,
                () => retryFeeCharge(slug, r.bookingId),
                `Charged ${usd(r.amountCents)}.`,
              )
            }
            className="rounded-md border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            {busyId === r.bookingId && pending ? "Charging…" : "Retry charge"}
          </button>
        )
      )}

      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (
            !window.confirm(
              `Write off ${usd(r.amountCents)} on #${r.displayNumber}? That records it as money we will never receive — if the operator collected it, use "Bill to operator" instead.`,
            )
          )
            return;
          act(r.bookingId, () => writeOffFee(slug, r.bookingId, r.reason), "Written off.");
        }}
        className="rounded-md border border-zinc-300 px-2 py-0.5 text-xs text-zinc-500 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        Write off
      </button>
    </li>
  );

  return (
    <div className="mt-4 space-y-5">
      <p className="text-sm">
        <span className="font-semibold tabular-nums">{usd(total)}</span>{" "}
        <span className="text-zinc-500">
          outstanding across {rows.length} booking{rows.length === 1 ? "" : "s"} ·{" "}
          {usd(settledTotal)} of it already collected by the operator
        </span>
      </p>
      {msg && <p className="text-sm text-emerald-600 dark:text-emerald-400">{msg}</p>}
      {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}

      {settled.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Tour has run — the operator is holding this
          </h3>
          <p className="mt-1 text-xs text-zinc-400">
            The customer already paid the balance at the venue, and our fee was inside it. Do not
            charge their card — they would pay twice. <strong>Bill to operator</strong> adds the
            amount to the operator&apos;s next platform invoice, so it collects itself.
            {!retainerActive && (
              <span className="mt-1 block text-amber-700 dark:text-amber-400">
                ⚠ This operator has no active retainer subscription yet, so there is no next invoice
                for the charge to ride on. It will be recorded and wait — set up their retainer to
                collect it.
              </span>
            )}
          </p>
          <ul className="mt-1">
            {settled.map((r) => (
              <Row key={r.bookingId} r={r} />
            ))}
          </ul>
        </div>
      )}

      {upcoming.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Tour still upcoming — the customer still owes it
          </h3>
          <p className="mt-1 text-xs text-zinc-400">
            The fee is sitting in a balance they have not paid yet. Retrying the card collects our
            share now and reduces what they owe at the desk by the same amount. Where no card was
            saved there is nothing to retry — it will simply be collected with the balance at
            check-in, and then move to the list above.
          </p>
          <ul className="mt-1">
            {upcoming.map((r) => (
              <Row key={r.bookingId} r={r} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

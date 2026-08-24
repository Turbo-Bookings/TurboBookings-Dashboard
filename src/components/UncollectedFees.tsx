"use client";

import { useState, useTransition } from "react";
import { retryFeeCharge, writeOffFee } from "@/lib/actions/uncollectedFees";
import type { UncollectedFee } from "@/lib/booking/platformFee";

const usd = (c: number) =>
  (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/**
 * Platform fee owed but not collected.
 *
 * Split into chaseable and not, because the split is the whole point: retrying a booking with no
 * saved card can never work, and a list that mixes the two becomes noise nobody reads. The
 * un-chaseable rows want a write-off, which is an acknowledgement rather than an erasure — the
 * amount stays on the booking so the running total of what we have forgone is still visible.
 *
 * FareHarbor imports no longer appear at all — they are written off on sight, since they have no
 * Stripe payment to charge. Everything here came through our own booking system.
 */
export function UncollectedFees({ slug, rows }: { slug: string; rows: UncollectedFee[] }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const chaseable = rows.filter((r) => r.chaseable);
  const stuck = rows.filter((r) => !r.chaseable);
  const total = rows.reduce((s, r) => s + r.amountCents, 0);

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
        Nothing outstanding — every platform fee has been collected or written off.
      </p>
    );
  }

  const Row = ({ r }: { r: UncollectedFee }) => (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-100 py-2 text-sm last:border-0 dark:border-zinc-800">
      <span className="w-20 font-mono text-xs text-zinc-500">#{r.displayNumber}</span>
      <span className="w-20 font-semibold tabular-nums">{usd(r.amountCents)}</span>
      <span className="min-w-0 flex-1 truncate text-zinc-600 dark:text-zinc-300">
        {r.customerEmail ?? "—"}
        <span className="ml-2 text-xs text-zinc-400">{r.reason}</span>
      </span>
      {r.chaseable && (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            act(r.bookingId, () => retryFeeCharge(slug, r.bookingId), `Charged ${usd(r.amountCents)}.`)
          }
          className="rounded-md border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {busyId === r.bookingId && pending ? "Charging…" : "Retry charge"}
        </button>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`Write off ${usd(r.amountCents)} on #${r.displayNumber}? It stops showing as outstanding.`)) return;
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
          {chaseable.length} can be retried
        </span>
      </p>
      {msg && <p className="text-sm text-emerald-600 dark:text-emerald-400">{msg}</p>}
      {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}

      {chaseable.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Has a card on file — worth retrying
          </h3>
          <ul className="mt-1">
            {chaseable.map((r) => (
              <Row key={r.bookingId} r={r} />
            ))}
          </ul>
        </div>
      )}

      {stuck.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            No way to charge — write these off
          </h3>
          <p className="mt-1 text-xs text-zinc-400">
            No card was saved at checkout, so there is nothing to charge and a retry cannot work.
            The customer is still billed either way: the fee sits in the balance they pay at
            check-in, so the operator collects it in cash. Settle with the operator, then write it
            off here to clear it — the amount stays recorded.
          </p>
          <ul className="mt-1">
            {stuck.map((r) => (
              <Row key={r.bookingId} r={r} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DateTime } from "luxon";
import { rescheduleBooking } from "@/lib/actions/bookings";

// startsAt arrives as a Date from the server action; itemName lets the operator see when a slot
// belongs to a DIFFERENT tour than the one booked.
type Slot = {
  id: string;
  startsAt: string | Date;
  remaining: number;
  itemId?: string;
  itemName?: string;
};

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export function RescheduleControls({
  slug,
  bookingId,
  currentId,
  currentItemId,
  slots,
  tz,
  onChanged,
}: {
  slug: string;
  bookingId: string;
  currentId: string;
  /** The tour currently booked — used to flag slots that belong to a different one. */
  currentItemId?: string;
  slots: Slot[];
  tz: string;
  onChanged?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [feeDollars, setFeeDollars] = useState("0");
  const [reason, setReason] = useState("");
  const [to, setTo] = useState("");

  const options = useMemo(
    () => slots.filter((s) => s.id !== currentId && s.remaining > 0),
    [slots, currentId],
  );

  // Group available slots by local (tz) date key.
  const byDate = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of options) {
      const key = DateTime.fromJSDate(new Date(s.startsAt)).setZone(tz).toISODate();
      if (!key) continue;
      const arr = m.get(key) ?? [];
      arr.push(s);
      m.set(key, arr);
    }
    for (const arr of m.values())
      arr.sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt));
    return m;
  }, [options, tz]);

  const firstKey = useMemo(() => {
    let min: string | null = null;
    for (const k of byDate.keys()) if (min === null || k < min) min = k;
    return min;
  }, [byDate]);

  const [viewMonth, setViewMonth] = useState(() =>
    (firstKey ? DateTime.fromISO(firstKey, { zone: tz }) : DateTime.now().setZone(tz)).startOf("month"),
  );
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  function go() {
    if (!to) return;
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const r = await rescheduleBooking(slug, bookingId, to, Math.round(Number(feeDollars) * 100), reason);
      if (!r.ok) setError(r.error ?? "Failed");
      else {
        // A move to a pricier tour ratchets our fee up and charges the card on file. That can decline,
        // and the balance then carries the difference — the operator needs to hear it now, not from a
        // report later.
        setNotice(r.notice ?? null);
        setTo("");
        setSelectedDate(null);
        router.refresh();
        onChanged?.();
      }
    });
  }

  // 6-week grid starting on the Sunday on/before the 1st.
  const monthStart = viewMonth.startOf("month");
  const gridStart = monthStart.minus({ days: monthStart.weekday % 7 });
  const cells = Array.from({ length: 42 }, (_, i) => gridStart.plus({ days: i }));
  const times = selectedDate ? byDate.get(selectedDate) ?? [] : [];

  return (
    <div className="mt-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Reschedule</h3>

      {options.length === 0 ? (
        <p className="mt-1 text-xs text-zinc-400">No other times available for this tour.</p>
      ) : (
        <div className="mt-3 max-w-xs">
          {/* Calendar */}
          <div className="flex items-center justify-between">
            <button type="button" onClick={() => setViewMonth(viewMonth.minus({ months: 1 }))} className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Previous month">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-medium">{viewMonth.toFormat("LLLL yyyy")}</span>
            <button type="button" onClick={() => setViewMonth(viewMonth.plus({ months: 1 }))} className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Next month">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-2 grid grid-cols-7 gap-1 text-center text-[10px] font-medium text-zinc-400">
            {WEEKDAYS.map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {cells.map((c) => {
              const key = c.toISODate()!;
              const inMonth = c.month === monthStart.month;
              const has = byDate.has(key);
              const selected = selectedDate === key;
              return (
                <button
                  key={key}
                  type="button"
                  disabled={!has}
                  onClick={() => {
                    setSelectedDate(key);
                    setTo("");
                  }}
                  className={`aspect-square rounded-md text-xs ${
                    selected
                      ? "bg-blue-600 font-semibold text-white"
                      : has
                        ? "bg-blue-50 font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-300"
                        : `text-zinc-300 dark:text-zinc-600 ${inMonth ? "" : "opacity-40"}`
                  }`}
                >
                  {c.day}
                </button>
              );
            })}
          </div>

          {/* Times for the selected date */}
          {selectedDate && (
            <div className="mt-3">
              <p className="mb-1 text-xs text-zinc-500">{DateTime.fromISO(selectedDate, { zone: tz }).toFormat("EEEE, LLL d")}</p>
              <div className="flex flex-wrap gap-1.5">
                {times.map((s) => {
                  const label = DateTime.fromJSDate(new Date(s.startsAt)).setZone(tz).toFormat("h:mm a");
                  const on = to === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setTo(s.id)}
                      className={`rounded-md border px-2 py-1 text-xs ${
                        on
                          ? "border-blue-500 bg-blue-50 font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                          : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      }`}
                    >
                      {label} <span className="text-zinc-400">({s.remaining})</span>
                      {/* Only when it differs from the booked tour — on a single-tour location this
                          never renders, and on a multi-tour one it is the difference between moving
                          the time and moving the customer onto a different (possibly pricier) tour. */}
                      {s.itemId && currentItemId && s.itemId !== currentItemId && (
                        <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                          {s.itemName}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Cross-tour warning — the price and the balance due will change on save. */}
          {to &&
            (() => {
              const sel = slots.find((x) => x.id === to);
              if (!sel?.itemId || !currentItemId || sel.itemId === currentItemId) return null;
              return (
                <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  Moving to <strong>{sel.itemName}</strong>. The booking is re-priced at that
                  tour&apos;s rates and any difference is added to the balance due at check-in.
                </p>
              );
            })()}

          {/* Fee + reason + confirm */}
          {to && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
              <span className="text-sm text-zinc-500">fee $</span>
              <input type="number" min={0} value={feeDollars} onChange={(e) => setFeeDollars(e.target.value)} className="w-16 rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" className="w-32 rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
              <button type="button" disabled={pending} onClick={go} className="rounded-md bg-blue-600 px-3 py-1 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                {pending ? "Moving…" : "Move"}
              </button>
            </div>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {notice && (
        <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">{notice}</p>
      )}
    </div>
  );
}

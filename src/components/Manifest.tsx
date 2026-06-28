"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Plus,
  Printer,
  Settings2,
  SlidersHorizontal,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { CheckInControls } from "@/components/CheckInControls";
import { OnlineStatusControl } from "@/components/OnlineStatusControl";
import { TONE_DOT, itemColor } from "@/lib/ui/itemColor";
import { checkInLabel, checkInTone } from "@/lib/ui/status";

type CheckIn = "not_yet" | "checked_in" | "no_show";
type Line = { id: string; ctName: string; quantity: number; checkInStatus: CheckIn };
type Booking = {
  id: string;
  displayNumber: string;
  customerName: string;
  customerPhone: string | null;
  balanceDueCents: number;
  partySize: number;
  notes: string | null;
  rollup: CheckIn | "mixed";
  lines: Line[];
};
type Slot = {
  availabilityId: string;
  itemId: string;
  itemName: string;
  onlineStatus: string;
  capacityMode: "resource_based" | "fixed";
  startsAt: Date;
  endsAt: Date;
  baseCapacity: number | null;
  booked: number;
  bookings: Booking[];
};

type Props = {
  slug: string;
  tz: string;
  dateKey: string;
  prevKey: string;
  nextKey: string;
  todayKey: string;
  dayLabel: string;
  items: { id: string; name: string }[];
  slots: Slot[];
};

type Cols = { phone: boolean; due: boolean; notes: boolean };
const DEFAULT_COLS: Cols = { phone: true, due: true, notes: false };

function usd(c: number): string {
  return (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function Manifest({
  slug,
  tz,
  dateKey,
  prevKey,
  nextKey,
  todayKey,
  dayLabel,
  items,
  slots,
}: Props) {
  const base = `/locations/${slug}`;
  const manifestBase = `${base}/manifest`;
  const [itemFilter, setItemFilter] = useState("all");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [cols, setCols] = useState<Cols>(DEFAULT_COLS);
  const [colsOpen, setColsOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    const s = localStorage.getItem("tb_manifest_cols");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (s) setCols({ ...DEFAULT_COLS, ...JSON.parse(s) });
  }, []);

  function setCol(k: keyof Cols, v: boolean) {
    const next = { ...cols, [k]: v };
    setCols(next);
    localStorage.setItem("tb_manifest_cols", JSON.stringify(next));
  }
  function toggleExpand(id: string) {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  const fmtTime = useMemo(
    () => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }),
    [tz],
  );

  const visibleSlots = slots.filter((s) => itemFilter === "all" || s.itemId === itemFilter);
  const linkCls =
    "inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Manifest
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {dayLabel} · {visibleSlots.length} slot{visibleSlots.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`${manifestBase}?date=${prevKey}`} className={linkCls} aria-label="Previous day">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          {dateKey !== todayKey && (
            <Link href={`${manifestBase}?date=${todayKey}`} className={linkCls}>
              Today
            </Link>
          )}
          <Link href={`${manifestBase}?date=${nextKey}`} className={linkCls} aria-label="Next day">
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <select
          value={itemFilter}
          onChange={(e) => setItemFilter(e.target.value)}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="all">All tours</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setPendingOnly((v) => !v)}
          className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
            pendingOnly
              ? "border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
              : "border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          }`}
        >
          Not checked in
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setColsOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <SlidersHorizontal className="h-4 w-4" /> Columns
          </button>
          {colsOpen && (
            <div className="absolute z-10 mt-1 w-44 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              {(["phone", "due", "notes"] as (keyof Cols)[]).map((k) => (
                <label key={k} className="flex items-center gap-2 rounded px-2 py-1 text-sm capitalize hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  <input type="checkbox" checked={cols[k]} onChange={(e) => setCol(k, e.target.checked)} className="h-4 w-4" />
                  {k}
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <a href={`${manifestBase}/export?date=${dateKey}`} className={linkCls}>
            <Download className="h-4 w-4" /> CSV
          </a>
          <button type="button" onClick={() => window.print()} className={linkCls}>
            <Printer className="h-4 w-4" /> Print
          </button>
        </div>
      </div>

      {visibleSlots.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-zinc-200 bg-zinc-50/50 p-12 text-center dark:border-zinc-800 dark:bg-zinc-900/30">
          <p className="text-sm text-zinc-500">No availability on this day.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {visibleSlots.map((s) => {
            const bookings = pendingOnly
              ? s.bookings.filter((b) => b.rollup !== "checked_in")
              : s.bookings;
            const available = s.baseCapacity != null ? Math.max(0, s.baseCapacity - s.booked) : null;
            const pct = s.baseCapacity ? Math.min(100, Math.round((s.booked / s.baseCapacity) * 100)) : 0;
            return (
              <div
                key={s.availabilityId}
                id={`slot-${s.availabilityId}`}
                className="scroll-mt-20 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
              >
                {/* Card header */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 bg-zinc-50/60 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-800/30">
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${TONE_DOT[itemColor(s.itemId)]}`} />
                    <span className="font-semibold text-zinc-900 dark:text-zinc-100">{s.itemName}</span>
                    <span className="text-sm text-zinc-500">
                      {fmtTime.format(s.startsAt)} – {fmtTime.format(s.endsAt)}
                    </span>
                  </div>
                  <Link
                    href={`${base}/bookings/new?item=${s.itemId}&availability=${s.availabilityId}`}
                    className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1.5 text-sm font-medium text-white hover:bg-blue-700 print:hidden"
                  >
                    <Plus className="h-4 w-4" /> Book
                  </Link>
                </div>

                {/* Sub-row */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-xs text-zinc-500">
                  <span className="print:hidden">
                    <OnlineStatusControl slug={slug} slotId={s.availabilityId} status={s.onlineStatus} />
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-medium text-zinc-700 dark:text-zinc-200">{s.booked} booked</span>
                    {available != null && <span>· {available} available</span>}
                    {s.baseCapacity != null && (
                      <span className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-zinc-200 sm:inline-block dark:bg-zinc-700">
                        <span className="block h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                      </span>
                    )}
                  </span>
                  <Link
                    href={`${base}/catalog/schedule/calendar?date=${dateKey}`}
                    className="ml-auto inline-flex items-center gap-1 hover:text-zinc-700 dark:hover:text-zinc-300 print:hidden"
                  >
                    <Settings2 className="h-3.5 w-3.5" /> Slot settings
                  </Link>
                </div>

                {/* Bookings table */}
                {bookings.length === 0 ? (
                  <p className="px-4 py-3 text-xs text-zinc-400">No bookings.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-t border-zinc-100 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
                        <th className="w-8" />
                        <th className="px-3 py-2 font-medium">ID</th>
                        <th className="px-3 py-2 font-medium">Contact</th>
                        <th className="px-3 py-2 font-medium">Riders</th>
                        <th className="px-3 py-2 font-medium">Check-in</th>
                        {cols.due && <th className="px-3 py-2 text-right font-medium">Due</th>}
                        {cols.notes && <th className="px-3 py-2 font-medium">Notes</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {bookings.map((b) => {
                        const open = expanded.has(b.id);
                        return (
                          <Fragment key={b.id}>
                            <tr className="border-t border-zinc-100 align-top dark:border-zinc-800">
                              <td className="py-2 pl-2">
                                <button
                                  type="button"
                                  onClick={() => toggleExpand(b.id)}
                                  className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                  aria-label="Expand"
                                >
                                  {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                </button>
                              </td>
                              <td className="px-3 py-2">
                                <Link href={`${base}/bookings/${b.id}`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-100">
                                  #{b.displayNumber}
                                </Link>
                              </td>
                              <td className="px-3 py-2">
                                <div className="font-medium text-zinc-900 dark:text-zinc-100">{b.customerName}</div>
                                {cols.phone && b.customerPhone && (
                                  <div className="text-xs text-zinc-500">{b.customerPhone}</div>
                                )}
                              </td>
                              <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">
                                <span className="font-medium">{b.partySize} total</span>
                                <div className="text-xs text-zinc-500">
                                  {b.lines.map((l) => `${l.quantity} ${l.ctName}`).join(", ")}
                                </div>
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex flex-col items-start gap-1">
                                  <Badge tone={checkInTone(b.rollup)}>{checkInLabel(b.rollup)}</Badge>
                                  <span className="print:hidden">
                                    <CheckInControls slug={slug} bookingId={b.id} current={b.rollup} size="sm" />
                                  </span>
                                </div>
                              </td>
                              {cols.due && (
                                <td className="px-3 py-2 text-right">
                                  <span className={b.balanceDueCents > 0 ? "font-medium text-red-600" : "text-zinc-400"}>
                                    {usd(b.balanceDueCents)}
                                  </span>
                                </td>
                              )}
                              {cols.notes && (
                                <td className="px-3 py-2 text-xs text-zinc-500">{b.notes ?? "—"}</td>
                              )}
                            </tr>
                            {open && (
                              <tr key={`${b.id}-x`} className="bg-zinc-50/60 dark:bg-zinc-800/20">
                                <td />
                                <td colSpan={5 + (cols.due ? 1 : 0) + (cols.notes ? 1 : 0)} className="px-3 py-3">
                                  <div className="space-y-2">
                                    {b.lines.map((l) => (
                                      <div key={l.id} className="flex flex-wrap items-center justify-between gap-2">
                                        <span className="text-sm">
                                          {l.quantity} × {l.ctName}
                                        </span>
                                        <span className="print:hidden">
                                          <CheckInControls slug={slug} lineId={l.id} current={l.checkInStatus} size="sm" />
                                        </span>
                                      </div>
                                    ))}
                                    <Link href={`${base}/bookings/${b.id}`} className="inline-block text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">
                                      Open booking →
                                    </Link>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

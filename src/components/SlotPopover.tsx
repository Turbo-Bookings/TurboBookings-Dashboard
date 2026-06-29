"use client";

import { useState } from "react";
import Link from "next/link";
import { ClipboardList, Lock, Plus, Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { TONE_DOT, itemColor } from "@/lib/ui/itemColor";
import type { GridSlot } from "@/lib/data/bookings";

export function SlotPopover({
  slug,
  dateKey,
  slot,
  timeLabel,
}: {
  slug: string;
  dateKey: string;
  slot: GridSlot;
  timeLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const base = `/locations/${slug}`;
  const tone = itemColor(slot.itemId);
  const total = slot.available != null ? slot.booked + slot.available : null;
  const pct = total && total > 0 ? Math.min(100, Math.round((slot.booked / total) * 100)) : 0;
  const closed = slot.onlineStatus === "off";

  const itemCls =
    "flex items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative block w-full overflow-hidden rounded-lg border border-zinc-200 bg-white py-2 pl-3 pr-3 text-left transition-shadow hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      >
        <span className={`absolute left-0 top-0 h-full w-1.5 ${TONE_DOT[tone]}`} />
        <div className="ml-1.5">
          <div className="flex items-center gap-1.5 text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {closed && <Lock className="h-3.5 w-3.5 text-zinc-400" />}
            <span>{timeLabel}</span>
            <span className="text-zinc-600 dark:text-zinc-300">{slot.itemName}</span>
            {slot.full && <Badge tone="red">Full</Badge>}
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-zinc-500">
            <span className="inline-flex items-center gap-1">
              <span className={`h-2.5 w-2.5 rounded-sm ${TONE_DOT[tone]}`} />
              {slot.booked} booked
            </span>
            {slot.available != null && (
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm border border-zinc-300 dark:border-zinc-600" />
                {slot.available} available
              </span>
            )}
          </div>
        </div>
        {total != null && (
          <span className="absolute bottom-0 left-0 h-1 w-full bg-zinc-100 dark:bg-zinc-800">
            <span className={`block h-full ${TONE_DOT[tone]}`} style={{ width: `${pct}%` }} />
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-xl border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
            <Link href={`${base}/bookings/new?item=${slot.itemId}&availability=${slot.availabilityId}`} className={`${itemCls} text-emerald-700 dark:text-emerald-400`}>
              <Plus className="h-4 w-4" /> New booking
            </Link>
            <Link href={`${base}/catalog/schedule/calendar?date=${dateKey}`} className={itemCls}>
              <Settings2 className="h-4 w-4" /> Actions &amp; Settings
            </Link>
            <Link href={`${base}/manifest?date=${dateKey}#slot-${slot.availabilityId}`} className={itemCls}>
              <ClipboardList className="h-4 w-4" /> Manifest
            </Link>

            {slot.riderCounts.length > 0 && (
              <div className="mt-1 border-t border-zinc-100 pt-2 dark:border-zinc-800">
                {slot.riderCounts.map((rc) => (
                  <div key={rc.ctName} className="flex items-center justify-between px-2.5 py-1 text-xs text-zinc-600 dark:text-zinc-300">
                    <span>{rc.ctName}</span>
                    <span className="inline-flex items-center gap-2">
                      <span className="inline-flex items-center gap-1">
                        <span className={`h-2 w-2 rounded-sm ${TONE_DOT[tone]}`} />
                        {rc.booked}
                      </span>
                      {slot.available != null && (
                        <span className="inline-flex items-center gap-1 text-zinc-400">
                          <span className="h-2 w-2 rounded-sm border border-zinc-300 dark:border-zinc-600" />
                          {slot.available}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

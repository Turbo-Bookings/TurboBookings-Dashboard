"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { searchBookings, type BookingSearchHit } from "@/lib/actions/bookings";
import { BookingModal } from "@/components/BookingModal";

export function SearchBookings({ slug }: { slug: string }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<BookingSearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      if (q.trim().length < 2) {
        setHits([]);
        setOpen(false);
        return;
      }
      searchBookings(slug, q).then((r) => {
        setHits(r);
        setOpen(true);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [q, slug]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

  return (
    <div ref={boxRef} className="relative">
      <div className="flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900">
        <Search className="h-4 w-4 text-zinc-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => hits.length > 0 && setOpen(true)}
          placeholder="Search bookings…"
          className="w-40 bg-transparent text-sm outline-none placeholder:text-zinc-400 sm:w-56"
        />
      </div>
      {/* Same viewport-overflow fix as RecentBookings: anchored to a mid-header
          trigger, an absolute right-0 panel runs off the left edge on a phone. */}
      {open && (
        <div className="fixed inset-x-2 top-16 z-40 overflow-hidden rounded-md border border-zinc-200 bg-white shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-1 sm:w-80 dark:border-zinc-800 dark:bg-zinc-900">
          {hits.length === 0 ? (
            <p className="px-3 py-2 text-sm text-zinc-500">No matches</p>
          ) : (
            hits.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => {
                  setOpenId(h.id);
                  setOpen(false);
                  setQ("");
                }}
                className="flex w-full flex-col items-start gap-0.5 border-b border-zinc-100 px-3 py-2 text-left last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
              >
                <span className="text-sm font-medium">
                  #{h.displayNumber} · {h.customerName}
                </span>
                <span className="text-xs text-zinc-500">
                  {h.itemName} · {fmt.format(h.startsAt)} · {h.status}
                </span>
              </button>
            ))
          )}
        </div>
      )}
      {openId && <BookingModal slug={slug} bookingId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

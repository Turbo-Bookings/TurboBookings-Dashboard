"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ClipboardList,
  Lock,
  MessageSquare,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { TONE_DOT, itemColor } from "@/lib/ui/itemColor";
import {
  deleteSlot,
  setSlotCapacity,
  setSlotStatus,
} from "@/lib/actions/availability";
import { messageSlotCustomers, moveSlotBookings } from "@/lib/actions/bookings";
import { getTourBookingData } from "@/lib/actions/manualBooking";
import type { GridSlot } from "@/lib/data/bookings";

type View = "menu" | "message" | "eliminate";
type Result = { ok: boolean; error?: string };

const itemCls =
  "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-200 dark:hover:bg-zinc-800";

export function SlotPopover({
  slug,
  dateKey,
  slot,
  timeLabel,
  tz,
}: {
  slug: string;
  dateKey: string;
  slot: GridSlot;
  timeLabel: string;
  tz: string;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("menu");
  const base = `/locations/${slug}`;
  const tone = itemColor(slot.itemId);
  const total = slot.available != null ? slot.booked + slot.available : null;
  const pct = total && total > 0 ? Math.min(100, Math.round((slot.booked / total) * 100)) : 0;
  const closed = slot.onlineStatus === "off";

  function close() {
    setOpen(false);
    setView("menu");
  }

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
          <div className="fixed inset-0 z-10" onClick={close} />
          <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-xl border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
            {view === "menu" && (
              <MenuView
                slug={slug}
                dateKey={dateKey}
                slot={slot}
                base={base}
                onMessage={() => setView("message")}
                onEliminate={() => setView("eliminate")}
                onClose={close}
              />
            )}
            {view === "message" && (
              <MessageView slug={slug} slot={slot} onBack={() => setView("menu")} />
            )}
            {view === "eliminate" && (
              <EliminateView slug={slug} slot={slot} tz={tz} onBack={() => setView("menu")} onDeleted={close} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MenuView({
  slug,
  dateKey,
  slot,
  base,
  onMessage,
  onEliminate,
  onClose,
}: {
  slug: string;
  dateKey: string;
  slot: GridSlot;
  base: string;
  onMessage: () => void;
  onEliminate: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [cap, setCap] = useState(slot.capacityOverride != null ? String(slot.capacityOverride) : "");

  function run(fn: () => Promise<Result>) {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Something went wrong");
      else router.refresh();
    });
  }

  const isFixed = slot.capacityMode === "fixed";

  return (
    <div>
      <Link href={`${base}/bookings/new?item=${slot.itemId}&availability=${slot.availabilityId}`} className={`${itemCls} text-emerald-700 dark:text-emerald-400`} onClick={onClose}>
        <Plus className="h-4 w-4" /> New booking
      </Link>
      <Link href={`${base}/manifest?date=${dateKey}#slot-${slot.availabilityId}`} className={itemCls} onClick={onClose}>
        <ClipboardList className="h-4 w-4" /> Manifest
      </Link>

      <div className="mt-1 border-t border-zinc-100 pt-2 dark:border-zinc-800">
        <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Availability</p>
        <div className="flex items-center gap-2 px-2.5 py-1">
          <span className="w-16 shrink-0 text-xs text-zinc-500">Online</span>
          <div className="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
            {(["auto", "on", "off"] as const).map((s) => (
              <button
                key={s}
                type="button"
                disabled={pending}
                onClick={() => run(() => setSlotStatus(slug, slot.availabilityId, s))}
                className={`px-2 py-1 text-xs capitalize transition-colors disabled:opacity-50 ${
                  slot.onlineStatus === s
                    ? "bg-blue-600 text-white"
                    : "bg-white text-zinc-600 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 px-2.5 py-1">
          <span className="w-16 shrink-0 text-xs text-zinc-500">Capacity</span>
          {isFixed ? (
            <input
              type="number"
              min={1}
              value={cap}
              placeholder="default"
              disabled={pending}
              onChange={(e) => setCap(e.target.value)}
              onBlur={() => {
                const orig = slot.capacityOverride != null ? String(slot.capacityOverride) : "";
                if (cap !== orig) run(() => setSlotCapacity(slug, slot.availabilityId, cap));
              }}
              className="w-24 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900"
              aria-label="Capacity override"
            />
          ) : (
            <span className="text-xs text-zinc-400">Auto · resource-limited</span>
          )}
        </div>
      </div>

      <div className="mt-1 border-t border-zinc-100 pt-1 dark:border-zinc-800">
        <button type="button" onClick={onMessage} disabled={slot.bookingCount === 0} className={itemCls}>
          <MessageSquare className="h-4 w-4" /> Message customers
          {slot.bookingCount > 0 && (
            <span className="ml-auto text-xs text-zinc-400">{slot.bookingCount}</span>
          )}
        </button>
        <button type="button" onClick={onEliminate} className={`${itemCls} text-red-600 dark:text-red-400`}>
          <Trash2 className="h-4 w-4" /> Eliminate slot
        </button>
      </div>

      {error && <p className="px-2.5 py-1 text-xs font-medium text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

function SubHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="mb-1 flex items-center gap-2 px-1 pb-1">
      <button type="button" onClick={onBack} className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Back">
        <ArrowLeft className="h-4 w-4" />
      </button>
      <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{title}</span>
    </div>
  );
}

function MessageView({ slug, slot, onBack }: { slug: string; slot: GridSlot; onBack: () => void }) {
  const [channel, setChannel] = useState<"email" | "sms" | "both">("email");
  const [audience, setAudience] = useState<"all" | "not_checked_in">("all");
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  function send() {
    setError(null);
    startTransition(async () => {
      const r = await messageSlotCustomers(slug, slot.availabilityId, channel, audience, body);
      if (!r.ok) setError(r.error ?? "Could not queue");
      else setDone(r.count ?? 0);
    });
  }

  if (done != null) {
    return (
      <div>
        <SubHeader title="Message customers" onBack={onBack} />
        <p className="rounded-md bg-emerald-50 px-3 py-3 text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
          Queued to {done} customer{done === 1 ? "" : "s"}. It will send once messaging goes live.
        </p>
        <button type="button" onClick={onBack} className={`${itemCls} mt-1 justify-center`}>Done</button>
      </div>
    );
  }

  const segCls = (active: boolean) =>
    `flex-1 px-2 py-1 text-xs capitalize transition-colors ${
      active ? "bg-blue-600 text-white" : "bg-white text-zinc-600 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
    }`;

  return (
    <div>
      <SubHeader title="Message customers" onBack={onBack} />
      <div className="space-y-2 px-1">
        <div>
          <p className="mb-1 text-[11px] font-medium text-zinc-500">Channel</p>
          <div className="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
            {(["email", "sms", "both"] as const).map((c) => (
              <button key={c} type="button" onClick={() => setChannel(c)} className={segCls(channel === c)}>{c}</button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1 text-[11px] font-medium text-zinc-500">Audience</p>
          <div className="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
            <button type="button" onClick={() => setAudience("all")} className={segCls(audience === "all")}>All</button>
            <button type="button" onClick={() => setAudience("not_checked_in")} className={`${segCls(audience === "not_checked_in")} normal-case`}>Not checked in</button>
          </div>
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          placeholder="Message to the slot's customers…"
          className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
        {error && <p className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p>}
        <button
          type="button"
          onClick={send}
          disabled={pending || !body.trim()}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Send className="h-4 w-4" /> {pending ? "Queuing…" : "Queue message"}
        </button>
        <p className="text-center text-[11px] text-zinc-400">Sends once the messaging service is live.</p>
      </div>
    </div>
  );
}

function EliminateView({
  slug,
  slot,
  tz,
  onBack,
  onDeleted,
}: {
  slug: string;
  slot: GridSlot;
  tz: string;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [slots, setSlots] = useState<
    { id: string; startsAt: string; remaining: number; fits: boolean }[] | null
  >(null);
  const [target, setTarget] = useState("");
  const [emptied, setEmptied] = useState(slot.bookingCount === 0);
  const [loading, setLoading] = useState(false);

  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  // Lazy-load same-tour target slots the first time the move panel shows.
  function loadTargets() {
    if (slots != null || loading) return;
    setLoading(true);
    startTransition(async () => {
      // Move the WHOLE group, so the basket is this slot's own rider breakdown. Filtering on a
      // scalar "remaining >= booked" offered targets that then rejected the save: a slot with three
      // free two-seaters looks big enough for four vehicles until one of them is a four-seater.
      const groupCart: Record<string, number> = {};
      for (const rc of slot.riderCounts) groupCart[rc.customerTypeId] = rc.booked;
      const r = await getTourBookingData(slug, slot.itemId, groupCart);
      setLoading(false);
      if (!r.ok) {
        setError(r.error);
        setSlots([]);
        return;
      }
      setSlots(r.slots.filter((s) => s.id !== slot.availabilityId && s.fits));
    });
  }

  function move() {
    if (!target) return;
    setError(null);
    startTransition(async () => {
      const r = await moveSlotBookings(slug, slot.availabilityId, target);
      if (!r.ok) setError(r.error ?? "Move failed");
      else {
        setEmptied(true);
        router.refresh();
      }
    });
  }

  function del() {
    setError(null);
    startTransition(async () => {
      const r = await deleteSlot(slug, slot.availabilityId);
      if (!r.ok) setError(r.error ?? "Delete failed");
      else {
        onDeleted();
        router.refresh();
      }
    });
  }

  return (
    <div>
      <SubHeader title="Eliminate slot" onBack={onBack} />
      <div className="space-y-2 px-1">
        {emptied ? (
          <>
            {slot.bookingCount > 0 && (
              <p className="rounded-md bg-emerald-50 px-2.5 py-2 text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                Bookings moved. This slot is now empty.
              </p>
            )}
            <p className="px-1 text-xs text-zinc-500">Delete this empty slot? This can’t be undone.</p>
            {error && <p className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p>}
            <button
              type="button"
              onClick={del}
              disabled={pending}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" /> {pending ? "Deleting…" : "Delete slot"}
            </button>
          </>
        ) : (
          <>
            <p className="rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              {slot.bookingCount} booking{slot.bookingCount === 1 ? "" : "s"} ({slot.booked} rider{slot.booked === 1 ? "" : "s"}) here. Move them to another time before deleting.
            </p>
            {slots == null ? (
              <button type="button" onClick={loadTargets} disabled={pending} className={`${itemCls} justify-center`}>
                {loading ? "Loading times…" : "Move bookings →"}
              </button>
            ) : slots.length === 0 ? (
              <p className="px-1 text-xs text-zinc-500">No other same-tour time has room for all {slot.booked} riders. Free up capacity or reschedule bookings individually from the manifest.</p>
            ) : (
              <>
                <select
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <option value="">Choose a new time…</option>
                  {slots.map((s) => (
                    <option key={s.id} value={s.id}>
                      {fmt.format(new Date(s.startsAt))} · {s.remaining} left
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-zinc-400">Each customer gets a queued “your time changed” notice.</p>
                {error && <p className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p>}
                <button
                  type="button"
                  onClick={move}
                  disabled={pending || !target}
                  className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {pending ? "Moving…" : `Move ${slot.bookingCount} booking${slot.bookingCount === 1 ? "" : "s"}`}
                </button>
              </>
            )}
            {error && slots == null && <p className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}

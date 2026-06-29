"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { DateTime } from "luxon";
import { Mail, Minus, Plus, X } from "lucide-react";
import { BookingActions } from "@/components/BookingActions";
import { LineCheckIn } from "@/components/CheckInControls";
import { RescheduleControls } from "@/components/RescheduleControls";
import { Badge } from "@/components/ui/Badge";
import {
  addBookingAdjustment,
  addVehicles,
  editBookingTotal,
  getBookingModalData,
  removeVehicles,
  requestCommunication,
} from "@/lib/actions/bookings";
import { bookingTone, checkInLabel, checkInTone } from "@/lib/ui/status";

type Data = Awaited<ReturnType<typeof getBookingModalData>>;

function usd(c: number): string {
  return (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}
function rollup(lines: { quantity: number; checkedInUnits: number; noShowUnits: number }[]): string {
  let q = 0, c = 0, n = 0;
  for (const l of lines) { q += l.quantity; c += l.checkedInUnits; n += l.noShowUnits; }
  if (q === 0 || (c === 0 && n === 0)) return "not_yet";
  if (c === q) return "checked_in";
  if (n === q) return "no_show";
  return "partial";
}

export function BookingModal({
  slug,
  bookingId,
  onClose,
}: {
  slug: string;
  bookingId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<Data>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    getBookingModalData(slug, bookingId).then((d) => {
      setData(d);
      setLoading(false);
    });
  }, [slug, bookingId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const base = `/locations/${slug}`;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
      <div className="relative w-full max-w-2xl rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
        <button onClick={onClose} className="absolute right-3 top-3 rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Close">
          <X className="h-5 w-5" />
        </button>

        {loading ? (
          <div className="p-10 text-center text-sm text-zinc-500">Loading…</div>
        ) : !data ? (
          <div className="p-10 text-center text-sm text-zinc-500">Booking not found.</div>
        ) : (
          <Body slug={slug} base={base} data={data} reload={reload} />
        )}
      </div>
    </div>
  );
}

function Body({
  slug,
  base,
  data,
  reload,
}: {
  slug: string;
  base: string;
  data: NonNullable<Data>;
  reload: () => void;
}) {
  const { detail, refund, rescheduleSlots, tz, hasCardOnFile } = data;
  const b = detail.booking;
  const cust = detail.customer;
  const when = detail.slot
    ? new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(detail.slot.startsAt)
    : "—";
  const checkin = rollup(detail.lines);

  return (
    <div className="max-h-[85vh] overflow-y-auto p-5">
      {/* Contact header */}
      <div className="pr-8">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          {[cust?.firstName, cust?.lastName].filter(Boolean).join(" ") || "Customer"}
        </h2>
        <p className="mt-0.5 text-sm text-zinc-500">
          {cust?.phoneE164 ? `${cust.phoneE164} · ` : ""}{cust?.emailLower}
        </p>
      </div>

      {/* Summary */}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">#{b.displayNumber}</span>
        <span className="text-zinc-500">{detail.item?.name}</span>
        <span className="text-zinc-500">{when}</span>
        <Badge tone={bookingTone(b.status)}>{b.status}</Badge>
        <Badge tone={checkInTone(checkin)}>{checkInLabel(checkin)}</Badge>
        <span className="ml-auto text-xs text-zinc-400">{b.source}</span>
      </div>

      {/* Vehicles + per-vehicle check-in + add/remove */}
      <Section title="Vehicles">
        <div className="space-y-4">
          {detail.lines.map((l) => (
            <div key={l.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">{l.quantity} × {l.ctName} <span className="text-zinc-400">@ {usd(l.unitPriceCents)}</span></span>
                <VehicleEditor slug={slug} lineId={l.id} reload={reload} />
              </div>
              <LineCheckIn slug={slug} lineId={l.id} ctName={l.ctName} quantity={l.quantity} checkedInUnits={l.checkedInUnits} noShowUnits={l.noShowUnits} onChanged={reload} />
            </div>
          ))}
        </div>
      </Section>

      {/* Pricing */}
      <Section title="Pricing">
        <dl className="space-y-1 text-sm">
          <Row label="Subtotal" value={usd(b.subtotalCents)} />
          {b.discountCents > 0 && <Row label="Discount" value={`−${usd(b.discountCents)}`} />}
          {b.platformFeeCents > 0 && <Row label="Processing fee" value={usd(b.platformFeeCents)} />}
          {b.taxCents > 0 && <Row label="Tax (paid online)" value={usd(b.taxCents)} />}
          <Row label="Total" value={usd(b.totalCents)} strong />
          <Row label="Paid" value={usd(b.depositPaidCents)} />
          {b.balanceDueCents > 0 && <Row label="Balance at venue" value={usd(b.balanceDueCents)} muted />}
          {b.refundedCents > 0 && <Row label="Refunded" value={usd(b.refundedCents)} muted />}
        </dl>
        {b.status === "active" && (
          <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
            <PriceEditors slug={slug} bookingId={b.id} total={b.totalCents} reload={reload} />
          </div>
        )}
      </Section>

      {/* Custom field responses */}
      {detail.fieldValues.length > 0 && (
        <Section title="Details">
          <ul className="space-y-1 text-sm">
            {detail.fieldValues.map((f, i) => (
              <li key={i} className="flex justify-between gap-4">
                <span className="text-zinc-500">{f.label}</span>
                <span className="text-right">{f.kind === "checkbox" ? (f.valueChecked ? "Yes" : "No") : f.kind === "quantity" ? String(f.valueQuantity ?? 0) : f.kind === "dropdown" ? f.valueDropdownSelected ?? "—" : f.valueText ?? "—"}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Booking actions (cancel / refund / holds) */}
      <BookingActions
        slug={slug}
        bookingId={b.id}
        status={b.status}
        refundLabel={refund.label}
        refundCents={refund.refundCents}
        hasCardOnFile={hasCardOnFile}
        holds={detail.holds.map((h) => ({ id: h.hold.id, status: h.hold.status, amountCents: h.hold.amountCents }))}
        onChanged={reload}
      />

      {b.status === "active" && (
        <RescheduleControls slug={slug} bookingId={b.id} currentId={b.availabilityId} slots={rescheduleSlots} tz={tz} onChanged={reload} />
      )}

      {/* Send message */}
      <Section title="Message customer">
        <SendMessage slug={slug} bookingId={b.id} />
      </Section>

      {/* Activity */}
      {detail.activity.length > 0 && (
        <Section title="Activity">
          <ul className="space-y-1 text-xs text-zinc-500">
            {detail.activity.map((a) => (
              <li key={a.id}>{DateTime.fromJSDate(a.createdAt).setZone(tz).toFormat("LLL d, h:mm a")} — {a.summary}</li>
            ))}
          </ul>
        </Section>
      )}

      <div className="mt-4 text-right">
        <Link href={`${base}/bookings/${b.id}`} className="text-xs text-zinc-400 hover:underline">Open full page →</Link>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>
      {children}
    </div>
  );
}
function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className={muted ? "text-zinc-400" : "text-zinc-600 dark:text-zinc-300"}>{label}</dt>
      <dd className={strong ? "font-semibold" : muted ? "text-zinc-400" : ""}>{value}</dd>
    </div>
  );
}

function VehicleEditor({ slug, lineId, reload }: { slug: string; lineId: string; reload: () => void }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  function act(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setErr(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setErr(r.error ?? "Failed");
      else reload();
    });
  }
  return (
    <span className="inline-flex items-center gap-1">
      <button type="button" disabled={pending} onClick={() => act(() => removeVehicles(slug, lineId, 1))} className="rounded-md border border-zinc-300 p-1 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800" title="Remove a vehicle"><Minus className="h-3.5 w-3.5" /></button>
      <button type="button" disabled={pending} onClick={() => act(() => addVehicles(slug, lineId, 1))} className="rounded-md border border-zinc-300 p-1 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800" title="Add a vehicle"><Plus className="h-3.5 w-3.5" /></button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </span>
  );
}

function PriceEditors({ slug, bookingId, total, reload }: { slug: string; bookingId: string; total: number; reload: () => void }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [totalStr, setTotalStr] = useState((total / 100).toFixed(2));
  const [expLabel, setExpLabel] = useState("");
  const [expAmt, setExpAmt] = useState("");
  function act(fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setErr(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setErr(r.error ?? "Failed");
      else { after?.(); reload(); }
    });
  }
  const cls = "rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900";
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-zinc-500">Set total $</span>
        <input value={totalStr} onChange={(e) => setTotalStr(e.target.value)} className={`w-24 ${cls}`} inputMode="decimal" />
        <button type="button" disabled={pending} onClick={() => act(() => editBookingTotal(slug, bookingId, Math.round(Number(totalStr) * 100)))} className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800">Save</button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-zinc-500">Expense/discount</span>
        <input value={expLabel} onChange={(e) => setExpLabel(e.target.value)} placeholder="Label" className={`w-28 ${cls}`} />
        <span className="text-zinc-500">$</span>
        <input value={expAmt} onChange={(e) => setExpAmt(e.target.value)} placeholder="−25 / 50" className={`w-20 ${cls}`} inputMode="decimal" />
        <button type="button" disabled={pending} onClick={() => act(() => addBookingAdjustment(slug, bookingId, expLabel, Math.round(Number(expAmt) * 100)), () => { setExpLabel(""); setExpAmt(""); })} className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800">Add</button>
      </div>
      {err && <p className="text-xs text-red-600">{err}</p>}
    </div>
  );
}

function SendMessage({ slug, bookingId }: { slug: string; bookingId: string }) {
  const [pending, start] = useTransition();
  const [channel, setChannel] = useState<"email" | "sms">("email");
  const [body, setBody] = useState("");
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <select value={channel} onChange={(e) => setChannel(e.target.value as "email" | "sms")} className="rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900">
          <option value="email">Email</option>
          <option value="sms">Text</option>
        </select>
        <span className="text-xs text-zinc-400">Queued to the messaging brain.</span>
      </div>
      <textarea value={body} onChange={(e) => { setBody(e.target.value); setDone(false); }} rows={2} placeholder="Message…" className="w-full rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={pending || !body.trim()}
          onClick={() => {
            setErr(null);
            start(async () => {
              const r = await requestCommunication(slug, bookingId, channel, body);
              if (!r.ok) setErr(r.error ?? "Failed");
              else { setDone(true); setBody(""); }
            });
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          <Mail className="h-4 w-4" /> Queue
        </button>
        {done && <span className="text-xs text-emerald-600">Queued — sends when messaging is live.</span>}
        {err && <span className="text-xs text-red-600">{err}</span>}
      </div>
    </div>
  );
}

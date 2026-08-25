"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { BookingNote } from "@/components/BookingNote";
import { CollectBalance } from "@/components/CollectBalance";
import { createPortal } from "react-dom";
import { sourceLabel } from "@/lib/bookingSource";
import Link from "next/link";
import { DateTime } from "luxon";
import { Mail, Minus, Plus, X } from "lucide-react";
import { BookingActions } from "@/components/BookingActions";
import { LineCheckIn } from "@/components/CheckInControls";
import { RescheduleControls } from "@/components/RescheduleControls";
import { BookingStamps } from "@/components/BookingStamps";
import { CustomerEditor } from "@/components/CustomerEditor";
import { useCaps } from "@/components/CapabilitiesProvider";
import { Badge } from "@/components/ui/Badge";
import {
  addBookingAdjustment,
  addLine,
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
  // Raised by CollectBalance between "card submitted" and "payment recorded". For that window the
  // modal must not be dismissible: unmounting it mid-charge means the customer is charged and the
  // booking never records it, which is the single worst outcome this screen can produce.
  const [paymentBusy, setPaymentBusy] = useState(false);

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

  // Portalled to <body> rather than rendered in place. This modal is opened from
  // the header (booking search, Recent bookings), and that header is
  // `sticky z-30 ... backdrop-blur` — backdrop-filter creates a STACKING
  // CONTEXT, so a `z-50` child of it is confined to the header's own z-30 layer
  // and paints BEHIND the page content. The symptom is a modal that opens but is
  // hidden behind the dashboard, which looks like a broken modal rather than a
  // CSS layering problem. A portal escapes every ancestor stacking context, so
  // this stays fixed no matter which component opens it or what wraps that
  // component later.
  const overlay = (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/40 sm:items-start sm:p-8">
      {/*
        Bottom sheet on phones, centred dialog from sm up. A centred card with
        margin wastes vertical space on a small screen and puts the close button
        near the top edge, which is the hardest place to reach one-handed; a
        sheet anchored to the bottom keeps the content where the thumb is.
        max-h + overflow keeps a long booking scrollable inside the sheet rather
        than pushing the page.
      */}
      <div className="relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-zinc-200 bg-white shadow-2xl sm:max-h-none sm:rounded-2xl dark:border-zinc-800 dark:bg-zinc-900">
        <button
          onClick={onClose}
          disabled={paymentBusy}
          className="absolute right-3 top-3 rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent dark:hover:bg-zinc-800"
          aria-label={paymentBusy ? "Can't close — a payment is going through" : "Close"}
          title={paymentBusy ? "A payment is going through. This will unlock when it finishes." : "Close"}
        >
          <X className="h-5 w-5" />
        </button>

        {loading ? (
          <div className="p-10 text-center text-sm text-zinc-500">Loading…</div>
        ) : !data ? (
          <div className="p-10 text-center text-sm text-zinc-500">Booking not found.</div>
        ) : (
          <Body
            slug={slug}
            base={base}
            data={data}
            reload={reload}
            onPaymentBusyChange={setPaymentBusy}
          />
        )}
      </div>
    </div>
  );

  // Guard for SSR / the first client render: document does not exist on the
  // server, and createPortal would throw.
  if (typeof document === "undefined") return null;
  return createPortal(overlay, document.body);
}

function Body({
  slug,
  base,
  data,
  reload,
  onPaymentBusyChange,
}: {
  slug: string;
  base: string;
  data: NonNullable<Data>;
  reload: () => void;
  onPaymentBusyChange: (busy: boolean) => void;
}) {
  const caps = useCaps();
  const [paymentBusy, setPaymentBusy] = useState(false);
  // Stable identity: CollectBalance reports through an effect keyed on this callback, so a fresh
  // arrow each render would re-fire it on every render of the booking.
  const handlePaymentBusy = useCallback(
    (bsy: boolean) => {
      setPaymentBusy(bsy);
      onPaymentBusyChange(bsy);
    },
    [onPaymentBusyChange],
  );
  const {
    detail,
    refund,
    rescheduleSlots,
    riderTypes,
    tz,
    hasCardOnFile,
    balanceQuote,
    publishableKey,
    stripeAccount,
  } = data;
  const b = detail.booking;
  const cust = detail.customer;
  const when = detail.slot
    ? new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(detail.slot.startsAt)
    : "—";
  const checkin = rollup(detail.lines);

  return (
    // `relative` so the in-payment shield below can cover the whole booking, however long it is.
    <div className="relative max-h-[85vh] overflow-y-auto p-5">
      {/*
        While a card is being charged, everything except the payment panel stops responding.
        Disabling the close button alone was not enough — the modal is full of live controls and
        links (add a rider, reschedule, cancel, open the full booking page), and any of them fired
        mid-charge either mutates the booking underneath the payment or navigates away from it.
        A shield is one element and covers every one of them, including the ones added later.
      */}
      {paymentBusy && (
        <div
          className="absolute inset-0 z-20 cursor-not-allowed bg-white/60 dark:bg-zinc-900/60"
          aria-hidden="true"
        />
      )}
      {/* Contact header */}
      <div className="pr-8">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          {[cust?.firstName, cust?.lastName].filter(Boolean).join(" ") || "Customer"}
        </h2>
        <div className="mt-0.5">
          <CustomerEditor
            slug={slug}
            bookingId={b.id}
            firstName={cust?.firstName ?? null}
            lastName={cust?.lastName ?? null}
            email={cust?.emailLower ?? null}
            phone={cust?.phoneE164 ?? null}
            canEdit={caps.manage_bookings}
            onChanged={reload}
          />
        </div>
        <BookingStamps createdAt={detail.createdAt} cancelledAt={detail.cancelledAt} tz={tz} />
      </div>

      {/* Summary */}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">#{b.displayNumber}</span>
        <span className="text-zinc-500">{detail.item?.name}</span>
        <span className="text-zinc-500">{when}</span>
        <Badge tone={bookingTone(b.status)}>{b.status}</Badge>
        <Badge tone={checkInTone(checkin)}>{checkInLabel(checkin)}</Badge>
        <span className="ml-auto text-xs text-zinc-400">{sourceLabel(b.source)}</span>
      </div>

      {/* Sits directly under the summary, above the vehicles — whoever opens
          this is usually about to check someone in, and a note they scroll past
          is a note that did not exist. */}
      <BookingNote
        slug={slug}
        bookingId={b.id}
        note={b.notes}
        canEdit={caps.manage_bookings}
        onSaved={reload}
      />

      {/* Vehicles + per-vehicle check-in + add/remove */}
      <Section title="Vehicles">
        <div className="space-y-4">
          {detail.lines.map((l) => (
            <div key={l.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">{l.quantity} × {l.ctName} <span className="text-zinc-400">@ {usd(l.unitPriceCents)}</span></span>
                {caps.manage_bookings && <VehicleEditor slug={slug} lineId={l.id} reload={reload} />}
              </div>
              <LineCheckIn slug={slug} lineId={l.id} ctName={l.ctName} quantity={l.quantity} checkedInUnits={l.checkedInUnits} noShowUnits={l.noShowUnits} onChanged={reload} />
            </div>
          ))}
          {b.status === "active" && caps.manage_bookings && riderTypes.length > 0 && (
            <AddRider slug={slug} bookingId={b.id} riderTypes={riderTypes} reload={reload} />
          )}
        </div>
      </Section>

      {/* Pricing */}
      <Section title="Pricing">
        <dl className="space-y-1 text-sm">
          {/*
            The CUSTOMER's breakdown, exactly as they saw it at checkout — subtotal, discount, one
            combined "Taxes & fees" line, total. Nobody sees our processing fee split out, admins
            included.

            It used to itemize "Processing fee" for `manage_platform` holders. Two reasons that had
            to go. It put our margin on a screen an operator stands over at a busy desk, where role
            gating is worth very little. And it made the dashboard disagree with the confirmation
            email in the customer's hand, so staff read two different breakdowns of one booking while
            answering a question about it.

            Our own fee accounting is unaffected and still exact — it lives on the admin-only
            uncollected-fees report and in Stripe.
          */}
          <Row label="Subtotal" value={usd(b.subtotalCents)} />
          {b.discountCents > 0 && <Row label="Discount" value={`−${usd(b.discountCents)}`} />}
          {b.platformFeeCents + b.taxCents > 0 && (
            <Row label="Taxes & fees" value={usd(b.platformFeeCents + b.taxCents)} />
          )}
          <Row label="Total" value={usd(b.totalCents)} strong />
          <Row label="Paid" value={usd(b.depositPaidCents)} />
          {b.balanceDueCents > 0 && <Row label="Balance at venue" value={usd(b.balanceDueCents)} muted />}
          {b.refundedCents > 0 && <Row label="Refunded" value={usd(b.refundedCents)} muted />}
        </dl>
        {b.status === "active" && caps.manage_bookings && (
          <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
            <PriceEditors slug={slug} bookingId={b.id} total={b.totalCents} reload={reload} />
          </div>
        )}
        {/*
          Taking the balance belongs HERE, not one page away. Check-in runs out of the manifest:
          tap the booking, check riders in, take payment. Having the card form on the separate
          booking page meant leaving that flow with a customer standing at the desk — so in practice
          the card got run on an outside terminal and we saw none of it.
        */}
        {balanceQuote && !("error" in balanceQuote) && (
          <div className="relative z-30 mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
            <CollectBalance
              slug={slug}
              quote={balanceQuote}
              publishableKey={publishableKey}
              stripeAccount={stripeAccount}
              onPaid={reload}
              onBusyChange={handlePaymentBusy}
            />
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
      {caps.refund && (
        <BookingActions
          slug={slug}
          bookingId={b.id}
          status={b.status}
          refundLabel={refund.label}
          refundCents={refund.refundCents}
          refundableCents={data.refundableCents}
          hasCardOnFile={hasCardOnFile}
          holds={detail.holds.map((h) => ({ id: h.hold.id, status: h.hold.status, amountCents: h.hold.amountCents }))}
          onChanged={reload}
        />
      )}

      {b.status === "active" && caps.manage_bookings && (
        <RescheduleControls slug={slug} bookingId={b.id} currentId={b.availabilityId} currentItemId={b.itemId} slots={rescheduleSlots} tz={tz} onChanged={reload} />
      )}

      {/* Send message */}
      {caps.manage_bookings && (
        <Section title="Message customer">
          <SendMessage slug={slug} bookingId={b.id} />
        </Section>
      )}

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
  const [notice, setNotice] = useState<string | null>(null);
  function act(fn: () => Promise<{ ok: boolean; error?: string; notice?: string }>) {
    setErr(null);
    setNotice(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setErr(r.error ?? "Failed");
      else {
        // Our 6% rises with the booking value, and the top-up is charged separately to the card on
        // file. It can fail. The operator needs to know THAT, right now, because the balance the
        // customer settles at the desk already contains the fee — collecting it is the whole fix.
        setNotice(r.notice ?? null);
        reload();
      }
    });
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <button type="button" disabled={pending} onClick={() => act(() => removeVehicles(slug, lineId, 1))} className="rounded-md border border-zinc-300 p-1 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800" title="Remove a vehicle"><Minus className="h-3.5 w-3.5" /></button>
      <button type="button" disabled={pending} onClick={() => act(() => addVehicles(slug, lineId, 1))} className="rounded-md border border-zinc-300 p-1 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800" title="Add a vehicle"><Plus className="h-3.5 w-3.5" /></button>
      {err && <span className="text-xs text-red-600">{err}</span>}
      {notice && (
        <span className="basis-full text-xs text-amber-700 dark:text-amber-400">{notice}</span>
      )}
    </span>
  );
}

// Add a rider of any type offered on the tour — including a type not on the
// original reservation (e.g. add a Double Rider to a Single-Rider booking).
function AddRider({
  slug,
  bookingId,
  riderTypes,
  reload,
}: {
  slug: string;
  bookingId: string;
  riderTypes: { ct: string; label: string; priceCents: number }[];
  reload: () => void;
}) {
  const [ctId, setCtId] = useState(riderTypes[0]?.ct ?? "");
  const [qty, setQty] = useState(1);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function submit() {
    setErr(null);
    setNotice(null);
    start(async () => {
      const r = await addLine(slug, bookingId, ctId, qty);
      if (!r.ok) setErr(r.error ?? "Failed");
      else {
        setNotice(r.notice ?? null);
        setQty(1);
        reload();
      }
    });
  }

  return (
    <div className="rounded-lg border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 text-sm font-medium text-zinc-600 dark:text-zinc-300">
          <Plus className="h-3.5 w-3.5" /> Add rider
        </span>
        <select
          value={ctId}
          onChange={(e) => setCtId(e.target.value)}
          className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          {riderTypes.map((t) => (
            <option key={t.ct} value={t.ct}>
              {t.label} · {usd(t.priceCents)}
            </option>
          ))}
        </select>
        <input
          type="number"
          min={1}
          value={qty}
          onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
          className="w-16 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="button"
          disabled={pending || !ctId}
          onClick={submit}
          className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Add
        </button>
        {err && <span className="text-xs text-red-600">{err}</span>}
      </div>
      {notice && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{notice}</p>}
      <p className="mt-1 text-xs text-zinc-400">Added riders bill to the balance due at the venue.</p>
    </div>
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

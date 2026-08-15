"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import {
  type AmountMode,
  type PaymentMethod,
  applyDiscountPreview,
  createDirectBooking,
  createOperatorIntent,
  getTourBookingData,
} from "@/lib/actions/manualBooking";
import { computeBooking } from "@/lib/pricing/breakdown";
import type { ChargeMode, DepositMode } from "@/lib/pricing/quote";
import { useCaps } from "@/components/CapabilitiesProvider";
import { BookingCalendar } from "@/components/BookingCalendar";

type ItemOpt = { id: string; name: string };
type Slot = { id: string; startsAt: string; remaining: number };
type Price = { ct: string; label: string; priceCents: number; taxBps: number | null };
type Field = { id: string; kind: string; label: string; helpText: string | null; required: boolean };

type LocationCfg = {
  depositMode: DepositMode;
  depositAmountCents: number | null;
  depositPercentBps: number | null;
  platformFeeBps: number;
  platformFeeMode: ChargeMode;
  taxRateBps: number;
  taxMode: ChargeMode;
};

type Payload = {
  itemId: string;
  availabilityId: string;
  lines: { ct: string; q: number }[];
  contact: { name: string; email: string; phone: string };
  note: string;
  subtotalOverrideCents: number | null;
  discountCode?: string;
  acknowledgments: { fieldId: string; checked: boolean }[];
  paymentMethod: PaymentMethod;
  amountMode: AmountMode;
  amountCents?: number;
};

type Props = {
  slug: string;
  tz: string;
  items: ItemOpt[];
  location: LocationCfg;
  publishableKey: string | null;
  stripeAccount: string | null;
  configured: boolean;
  lockedItem?: { id: string; name: string };
  lockedSlot?: { id: string; label: string };
};

function usd(c: number): string {
  return (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}
const input =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

export function NewBookingForm({ slug, tz, items, location, publishableKey, stripeAccount, configured, lockedItem, lockedSlot }: Props) {
  const router = useRouter();
  const caps = useCaps();
  const [itemId, setItemId] = useState(lockedItem?.id ?? "");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [pricing, setPricing] = useState<Price[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [slotId, setSlotId] = useState(lockedSlot?.id ?? "");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [overrideStr, setOverrideStr] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [discount, setDiscount] = useState<{ cents: number; label: string; code: string } | null>(null);
  const [discountErr, setDiscountErr] = useState<string | null>(null);
  const [acks, setAcks] = useState<Set<string>>(new Set());
  const [amountMode, setAmountMode] = useState<AmountMode>("full");
  const [partialStr, setPartialStr] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("card");
  const [grouponStr, setGrouponStr] = useState("");
  const [loadingTour, setLoadingTour] = useState(!!lockedItem);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // "YYYY-MM-DD" in the location tz (en-CA yields ISO-ordered parts).
  const fmtDayKey = useMemo(
    () => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }),
    [tz],
  );
  const fmtTime = useMemo(
    () => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }),
    [tz],
  );
  // Group availability by tz-local day so the calendar can show which days are
  // bookable and the time step can list that day's slots.
  const slotsByDay = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const s of slots) {
      const key = fmtDayKey.format(new Date(s.startsAt));
      const arr = map.get(key);
      if (arr) arr.push(s);
      else map.set(key, [s]);
    }
    return map;
  }, [slots, fmtDayKey]);
  const availableDays = useMemo(() => [...slotsByDay.keys()].sort(), [slotsByDay]);
  const daySlots = selectedDay ? (slotsByDay.get(selectedDay) ?? []) : [];

  async function loadData(id: string) {
    const r = await getTourBookingData(slug, id);
    setLoadingTour(false);
    if (r.ok) {
      setSlots(r.slots);
      setPricing(r.pricing);
      setFields(r.customFields);
    } else setError(r.error);
  }
  function onTour(id: string) {
    setItemId(id);
    setSlotId("");
    setSelectedDay(null);
    setQty({});
    setDiscount(null);
    setAcks(new Set());
    if (!id) {
      setSlots([]);
      setPricing([]);
      setFields([]);
      return;
    }
    setLoadingTour(true);
    loadData(id);
  }
  useEffect(() => {
    // Locked mode: load the tour's pricing + fields on mount (async fetch).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (lockedItem) loadData(lockedItem.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedItem?.id]);

  // ---- computed pricing ----
  const activeLines = pricing.filter((p) => (qty[p.ct] ?? 0) > 0);
  const lineSubtotal = activeLines.reduce((s, p) => s + qty[p.ct] * p.priceCents, 0);
  const overrideCents =
    overrideStr.trim() !== "" && Number(overrideStr) >= 0 ? Math.round(Number(overrideStr) * 100) : null;
  const baseSubtotal = overrideCents ?? lineSubtotal;
  const discountCents = discount ? Math.min(discount.cents, baseSubtotal) : 0;
  const totalQty = activeLines.reduce((s, p) => s + qty[p.ct], 0);
  const amountCents =
    method === "groupon_ota"
      ? Math.round(Number(grouponStr || "0") * 100)
      : amountMode === "partial"
        ? Math.round(Number(partialStr || "0") * 100)
        : undefined;
  const c = computeBooking({
    baseSubtotalCents: baseSubtotal,
    discountCents,
    taxRateBps: location.taxRateBps,
    taxMode: location.taxMode,
    platformFeeBps: location.platformFeeBps,
    platformFeeMode: location.platformFeeMode,
    depositMode: location.depositMode,
    depositAmountCents: location.depositAmountCents,
    depositPercentBps: location.depositPercentBps,
    totalQty,
    paymentMethod: method,
    amountMode,
    amountCents,
  });
  const total = c.totalCents;
  const dueNow = c.dueNowCents;
  const payLater = c.balanceDueCents;

  const requiredAcks = fields.filter((f) => f.kind === "checkbox" && f.required);
  const ackOk = requiredAcks.every((f) => acks.has(f.id));
  const checkboxFields = fields.filter((f) => f.kind === "checkbox");
  const canSubmit = Boolean(itemId && slotId && totalQty > 0 && name.trim() && email.includes("@") && ackOk);

  function buildPayload(): Payload {
    return {
      itemId,
      availabilityId: slotId,
      lines: activeLines.map((p) => ({ ct: p.ct, q: qty[p.ct] })),
      contact: { name, email, phone },
      note,
      subtotalOverrideCents: overrideCents,
      discountCode: discount?.code,
      acknowledgments: checkboxFields.map((f) => ({ fieldId: f.id, checked: acks.has(f.id) })),
      paymentMethod: method,
      amountMode,
      amountCents:
        method === "groupon_ota"
          ? Math.round(Number(grouponStr || "0") * 100)
          : amountMode === "partial"
            ? Math.round(Number(partialStr || "0") * 100)
            : undefined,
    };
  }

  async function applyCode() {
    setDiscountErr(null);
    const r = await applyDiscountPreview(slug, itemId, activeLines.map((p) => p.ct), baseSubtotal, codeInput);
    if (r.ok) setDiscount({ cents: r.appliedAmountCents, label: r.label, code: r.code });
    else {
      setDiscount(null);
      setDiscountErr(r.error);
    }
  }

  async function bookNonCard() {
    setError(null);
    setSubmitting(true);
    const r = await createDirectBooking(slug, buildPayload());
    if (!r.ok) {
      setError(r.error);
      setSubmitting(false);
      return;
    }
    router.push(`/locations/${slug}/bookings/${r.bookingId}`);
  }

  const stripePromise = useMemo<Promise<Stripe | null> | null>(() => {
    if (!configured || !publishableKey) return null;
    return loadStripe(publishableKey, stripeAccount ? { stripeAccount } : undefined);
  }, [configured, publishableKey, stripeAccount]);

  const ready = itemId && !loadingTour;

  return (
    <div className="max-w-2xl space-y-5">
      {/* Tour + time */}
      {lockedItem ? (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <span className="text-zinc-500">Tour:</span> <span className="font-medium">{lockedItem.name}</span>
          {lockedSlot && (
            <>
              {" · "}
              <span className="text-zinc-500">Time:</span> <span className="font-medium">{lockedSlot.label}</span>
            </>
          )}
        </div>
      ) : (
        <div>
          <label className="block text-sm font-medium">Tour</label>
          <select className={`mt-1 ${input}`} value={itemId} onChange={(e) => onTour(e.target.value)}>
            <option value="">Select a tour…</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
        </div>
      )}

      {loadingTour && <p className="text-sm text-zinc-500">Loading…</p>}

      {ready && (
        <>
          {!lockedSlot && (
            <div>
              <label className="block text-sm font-medium">Date &amp; time</label>
              {availableDays.length === 0 ? (
                <p className="mt-1 text-sm text-zinc-500">No open dates for this tour.</p>
              ) : (
                <div className="mt-1 space-y-3">
                  <BookingCalendar
                    availableDays={availableDays}
                    selected={selectedDay}
                    onSelect={(key) => {
                      setSelectedDay(key);
                      setSlotId("");
                    }}
                  />
                  {selectedDay && (
                    <div className="flex flex-wrap gap-2">
                      {daySlots.map((s) => {
                        const on = s.id === slotId;
                        const full = s.remaining <= 0;
                        return (
                          <button
                            key={s.id}
                            type="button"
                            disabled={full}
                            onClick={() => setSlotId(s.id)}
                            className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                              on
                                ? "border-blue-600 bg-blue-600 text-white"
                                : full
                                  ? "cursor-not-allowed border-zinc-200 text-zinc-300 dark:border-zinc-800 dark:text-zinc-600"
                                  : "border-zinc-300 text-zinc-700 hover:border-blue-300 hover:bg-blue-50/40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:border-blue-800 dark:hover:bg-blue-950/20"
                            }`}
                          >
                            {fmtTime.format(new Date(s.startsAt))}
                            <span className={`ml-1.5 text-xs ${on ? "text-blue-100" : "text-zinc-400"}`}>
                              {full ? "full" : `${s.remaining} left`}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Riders */}
          <div>
            <label className="block text-sm font-medium">Riders</label>
            <div className="mt-1 space-y-2">
              {pricing.map((p) => (
                <div key={p.ct} className="flex items-center justify-between">
                  <span className="text-sm">{p.label} <span className="text-zinc-400">{usd(p.priceCents)}</span></span>
                  <div className="flex items-center gap-2">
                    <button type="button" className="h-7 w-7 rounded-md border border-zinc-300 dark:border-zinc-700" onClick={() => setQty((x) => ({ ...x, [p.ct]: Math.max(0, (x[p.ct] ?? 0) - 1) }))}>−</button>
                    <span className="w-6 text-center text-sm">{qty[p.ct] ?? 0}</span>
                    <button type="button" className="h-7 w-7 rounded-md border border-zinc-300 dark:border-zinc-700" onClick={() => setQty((x) => ({ ...x, [p.ct]: (x[p.ct] ?? 0) + 1 }))}>+</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Customer */}
          <div className="grid grid-cols-1 gap-2">
            <label className="block text-sm font-medium">Customer</label>
            <input className={input} placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
            <input className={input} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className={input} type="tel" placeholder="Phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <textarea className={input} rows={2} placeholder="Booking note (staff-only — shows on the manifest)" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          {/* Acknowledgments */}
          {checkboxFields.length > 0 && (
            <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <p className="mb-2 text-sm font-medium">Acknowledgments</p>
              <div className="space-y-2">
                {checkboxFields.map((f) => (
                  <label key={f.id} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={acks.has(f.id)}
                      onChange={(e) =>
                        setAcks((s) => {
                          const n = new Set(s);
                          if (e.target.checked) n.add(f.id);
                          else n.delete(f.id);
                          return n;
                        })
                      }
                      className="mt-0.5 h-4 w-4"
                    />
                    <span>
                      {f.label}
                      {f.required && <span className="text-red-500"> *</span>}
                      {f.helpText && <span className="block text-xs text-zinc-500">{f.helpText}</span>}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Pricing breakdown */}
          {totalQty > 0 && (
            <div className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
              <div className="flex items-center justify-between">
                <span>Subtotal</span>
                <span className="flex items-center gap-1">
                  <span className="text-zinc-400">$</span>
                  <input
                    inputMode="decimal"
                    value={overrideStr}
                    onChange={(e) => setOverrideStr(e.target.value)}
                    placeholder={(lineSubtotal / 100).toFixed(2)}
                    className="w-20 rounded-md border border-zinc-300 px-2 py-0.5 text-right text-sm dark:border-zinc-700 dark:bg-zinc-900"
                    title="Override the subtotal for a custom rate"
                  />
                </span>
              </div>

              <div className="mt-2 flex items-center gap-2">
                <input className="flex-1 rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900" placeholder="Discount code" value={codeInput} onChange={(e) => setCodeInput(e.target.value)} />
                <button type="button" onClick={applyCode} className="rounded-md border border-zinc-300 px-3 py-1 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">Apply</button>
              </div>
              {discount && (
                <div className="mt-1 flex items-center justify-between text-emerald-700 dark:text-emerald-400">
                  <span>{discount.code} ({discount.label})</span>
                  <span className="flex items-center gap-2">−{usd(discountCents)}
                    <button type="button" onClick={() => setDiscount(null)} className="text-xs text-zinc-400 hover:underline">remove</button>
                  </span>
                </div>
              )}
              {discountErr && <p className="mt-1 text-xs text-red-600">{discountErr}</p>}

              {/* Platform fee is Turbo-internal — operators see it bundled with
                  tax (as the customer does at checkout); admins see it itemized. */}
              {caps.manage_platform ? (
                <>
                  {c.feeCents > 0 && (
                    <div className="mt-2 flex justify-between text-zinc-500"><span>Processing fee</span><span>{usd(c.feeCents)}</span></div>
                  )}
                  {c.onlineTaxCents > 0 && (
                    <div className="flex justify-between text-zinc-500"><span>Tax (on amount paid now)</span><span>{usd(c.onlineTaxCents)}</span></div>
                  )}
                </>
              ) : (
                (c.feeCents + c.onlineTaxCents) > 0 && (
                  <div className="mt-2 flex justify-between text-zinc-500"><span>Taxes &amp; fees</span><span>{usd(c.feeCents + c.onlineTaxCents)}</span></div>
                )
              )}
              <div className="mt-1 flex justify-between border-t border-zinc-100 pt-1 font-semibold dark:border-zinc-800"><span>Total</span><span>{usd(total)}</span></div>
              {dueNow !== total && (
                <>
                  <div className="mt-1 flex justify-between"><span>Due now</span><span className="font-medium">{usd(dueNow)}</span></div>
                  <div className="flex justify-between text-zinc-500"><span>Pay later</span><span>{usd(payLater)}</span></div>
                </>
              )}
            </div>
          )}

          {/* Payment method */}
          <div>
            <label className="block text-sm font-medium">Payment</label>
            <div className="mt-1 flex flex-wrap gap-2">
              {([
                ["card", "Charge card"],
                ["groupon_ota", "Groupon / OTA"],
                ["walk_in", "Walk-in (pay at venue)"],
              ] as [PaymentMethod, string][]).map(([m, label]) => (
                <button key={m} type="button" onClick={() => setMethod(m)} className={`rounded-md border px-3 py-1.5 text-sm font-medium ${method === m ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300" : "border-zinc-300 dark:border-zinc-700"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Amount mode (card only) */}
          {method === "card" && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {([
                ["full", "Pay in full"],
                ["deposit", `Pay deposit (${usd(Math.min(c.depositCents, total))})`],
                ["partial", "Partial"],
              ] as [AmountMode, string][]).map(([m, label]) => (
                <button key={m} type="button" onClick={() => setAmountMode(m)} className={`rounded-md border px-3 py-1 text-sm font-medium ${amountMode === m ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300" : "border-zinc-300 dark:border-zinc-700"}`}>
                  {label}
                </button>
              ))}
              {amountMode === "partial" && (
                <span className="flex items-center gap-1">$<input inputMode="decimal" value={partialStr} onChange={(e) => setPartialStr(e.target.value)} className="w-24 rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900" /></span>
              )}
            </div>
          )}

          {method === "groupon_ota" && (
            <div className="flex items-center gap-2 text-sm">
              <span>Prepaid amount</span>
              <span className="flex items-center gap-1">$<input inputMode="decimal" value={grouponStr} onChange={(e) => setGrouponStr(e.target.value)} placeholder="0.00" className="w-24 rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900" /></span>
              <span className="text-xs text-zinc-500">Remainder becomes balance due.</span>
            </div>
          )}

          {error && <p className="text-sm font-medium text-red-600">{error}</p>}

          {/* Submit */}
          {method === "card" ? (
            !stripePromise ? (
              <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                Stripe isn&apos;t configured — add keys to charge cards, or use Walk-in / Groupon-OTA.
              </p>
            ) : dueNow >= 50 ? (
              <Elements key={dueNow} stripe={stripePromise} options={{ mode: "payment", amount: dueNow, currency: "usd", setupFutureUsage: "off_session" }}>
                <CardCheckout slug={slug} getPayload={buildPayload} amountCents={dueNow} disabled={!canSubmit} onError={setError} onDone={(id) => router.push(`/locations/${slug}/bookings/${id}`)} />
              </Elements>
            ) : (
              <p className="text-sm text-zinc-500">Add riders to charge a card.</p>
            )
          ) : (
            <button type="button" disabled={!canSubmit || submitting} onClick={bookNonCard} className="w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {submitting ? "Booking…" : method === "groupon_ota" ? "Record Groupon/OTA booking" : "Book (pay at venue)"}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function CardCheckout({
  slug,
  getPayload,
  amountCents,
  disabled,
  onError,
  onDone,
}: {
  slug: string;
  getPayload: () => Payload;
  amountCents: number;
  disabled: boolean;
  onError: (e: string) => void;
  onDone: (bookingId: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);

  async function charge() {
    if (!stripe || !elements) return;
    onError("");
    setBusy(true);
    const payload = getPayload();
    const { error: subErr } = await elements.submit();
    if (subErr) {
      onError(subErr.message ?? "Check card details");
      setBusy(false);
      return;
    }
    const intent = await createOperatorIntent(slug, payload);
    if (!intent.ok) {
      onError(intent.error);
      setBusy(false);
      return;
    }
    const { error: confErr, paymentIntent } = await stripe.confirmPayment({
      elements,
      clientSecret: intent.clientSecret,
      redirect: "if_required",
    });
    if (confErr || !paymentIntent || paymentIntent.status !== "succeeded") {
      onError(confErr?.message ?? "Payment failed");
      setBusy(false);
      return;
    }
    const r = await createDirectBooking(slug, payload, paymentIntent.id);
    if (!r.ok) {
      onError(r.error);
      setBusy(false);
      return;
    }
    onDone(r.bookingId);
  }

  return (
    <div className="space-y-3">
      <PaymentElement />
      <button type="button" disabled={busy || disabled} onClick={charge} className="w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
        {busy ? "Charging…" : `Charge ${usd(amountCents)} & book`}
      </button>
      {disabled && <p className="text-center text-xs text-zinc-500">Complete name, email &amp; required acknowledgments to enable.</p>}
    </div>
  );
}

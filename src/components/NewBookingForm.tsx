"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import {
  createDirectBooking,
  createOperatorIntent,
  getTourBookingData,
} from "@/lib/actions/manualBooking";
import { quote, type ChargeMode, type DepositMode } from "@/lib/pricing/quote";

type ItemOpt = { id: string; name: string };
type Slot = { id: string; startsAt: string; remaining: number };
type Price = { ct: string; label: string; priceCents: number; taxBps: number | null };

type LocationCfg = {
  depositMode: DepositMode;
  depositAmountCents: number | null;
  depositPercentBps: number | null;
  platformFeeBps: number;
  platformFeeMode: ChargeMode;
  taxRateBps: number;
  taxMode: ChargeMode;
};

type Props = {
  slug: string;
  tz: string;
  items: ItemOpt[];
  location: LocationCfg;
  publishableKey: string | null;
  stripeAccount: string | null;
  configured: boolean;
  // When launched from a manifest/grid slot, the tour + time are pre-set + locked.
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
  const [itemId, setItemId] = useState(lockedItem?.id ?? "");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [pricing, setPricing] = useState<Price[]>([]);
  const [slotId, setSlotId] = useState(lockedSlot?.id ?? "");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [payMode, setPayMode] = useState<"venue" | "card">("venue");
  const [loadingTour, setLoadingTour] = useState(!!lockedItem);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fmtSlot = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    [tz],
  );

  async function onTour(id: string) {
    setItemId(id);
    setSlotId("");
    setQty({});
    if (!id) {
      setSlots([]);
      setPricing([]);
      return;
    }
    setLoadingTour(true);
    const r = await getTourBookingData(slug, id);
    setLoadingTour(false);
    if (r.ok) {
      setSlots(r.slots);
      setPricing(r.pricing);
    } else setError(r.error);
  }

  // Locked mode (launched from a slot): load pricing on mount, keep the preset slot.
  useEffect(() => {
    if (!lockedItem) return;
    let active = true;
    getTourBookingData(slug, lockedItem.id).then((r) => {
      if (!active) return;
      setLoadingTour(false);
      if (r.ok) {
        setSlots(r.slots);
        setPricing(r.pricing);
      } else setError(r.error);
    });
    return () => {
      active = false;
    };
  }, [lockedItem, slug]);

  const lines = pricing
    .filter((p) => (qty[p.ct] ?? 0) > 0)
    .map((p) => ({ ct: p.ct, q: qty[p.ct] }));
  const q = quote({
    lines: pricing
      .filter((p) => (qty[p.ct] ?? 0) > 0)
      .map((p) => ({ quantity: qty[p.ct], unitPriceCents: p.priceCents, taxRateBpsOverride: p.taxBps })),
    ...location,
  });
  const totalQty = lines.reduce((s, l) => s + l.q, 0);
  const canSubmit = Boolean(itemId && slotId && totalQty > 0 && name.trim() && email.includes("@"));
  const payload = { itemId, availabilityId: slotId, lines, contact: { name, email, phone } };

  async function bookAtVenue() {
    setError(null);
    setSubmitting(true);
    const r = await createDirectBooking(slug, payload);
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

  return (
    <div className="max-w-xl space-y-5">
      {lockedItem ? (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <span className="text-zinc-500">Tour:</span>{" "}
          <span className="font-medium">{lockedItem.name}</span>
        </div>
      ) : (
        <div>
          <label className="block text-sm font-medium">Tour</label>
          <select className={`mt-1 ${input}`} value={itemId} onChange={(e) => onTour(e.target.value)}>
            <option value="">Select a tour…</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {loadingTour && <p className="text-sm text-zinc-500">Loading availability…</p>}

      {itemId && !loadingTour && (
        <>
          {lockedSlot ? (
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
              <span className="text-zinc-500">Time:</span>{" "}
              <span className="font-medium">{lockedSlot.label}</span>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium">Date &amp; time</label>
              <select className={`mt-1 ${input}`} value={slotId} onChange={(e) => setSlotId(e.target.value)}>
                <option value="">Select a time…</option>
                {slots.map((s) => (
                  <option key={s.id} value={s.id} disabled={s.remaining <= 0}>
                    {fmtSlot.format(new Date(s.startsAt))} ({s.remaining} left)
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium">Riders</label>
            <div className="mt-1 space-y-2">
              {pricing.map((p) => (
                <div key={p.ct} className="flex items-center justify-between">
                  <span className="text-sm">
                    {p.label} <span className="text-zinc-400">{usd(p.priceCents)}</span>
                  </span>
                  <div className="flex items-center gap-2">
                    <button type="button" className="h-7 w-7 rounded-md border border-zinc-300 dark:border-zinc-700" onClick={() => setQty((x) => ({ ...x, [p.ct]: Math.max(0, (x[p.ct] ?? 0) - 1) }))}>
                      −
                    </button>
                    <span className="w-6 text-center text-sm">{qty[p.ct] ?? 0}</span>
                    <button type="button" className="h-7 w-7 rounded-md border border-zinc-300 dark:border-zinc-700" onClick={() => setQty((x) => ({ ...x, [p.ct]: (x[p.ct] ?? 0) + 1 }))}>
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2">
            <input className={input} placeholder="Customer name" value={name} onChange={(e) => setName(e.target.value)} />
            <input className={input} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className={input} type="tel" placeholder="Phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>

          {totalQty > 0 && (
            <div className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
              <div className="flex justify-between"><span>Total</span><span className="font-semibold">{usd(q.subtotalCents + q.taxCents + q.feeCents)}</span></div>
              <div className="flex justify-between text-zinc-500"><span>Due online (if charged)</span><span>{usd(q.totalDueOnlineCents)}</span></div>
            </div>
          )}

          <div className="flex gap-2">
            {(["venue", "card"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setPayMode(m)}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium ${payMode === m ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300" : "border-zinc-300 dark:border-zinc-700"}`}
              >
                {m === "venue" ? "Pay at venue" : "Charge card now"}
              </button>
            ))}
          </div>

          {error && <p className="text-sm font-medium text-red-600">{error}</p>}

          {payMode === "venue" ? (
            <button
              type="button"
              disabled={!canSubmit || submitting}
              onClick={bookAtVenue}
              className="w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? "Booking…" : "Book (balance due at venue)"}
            </button>
          ) : !stripePromise ? (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
              Stripe isn&apos;t configured — add keys to charge cards. Use &ldquo;Pay at venue&rdquo; for now.
            </p>
          ) : canSubmit && q.totalDueOnlineCents >= 50 ? (
            <Elements key={q.totalDueOnlineCents} stripe={stripePromise} options={{ mode: "payment", amount: q.totalDueOnlineCents, currency: "usd", setupFutureUsage: "off_session" }}>
              <CardCheckout slug={slug} payload={payload} amountCents={q.totalDueOnlineCents} onError={setError} onDone={(id) => router.push(`/locations/${slug}/bookings/${id}`)} />
            </Elements>
          ) : (
            <p className="text-sm text-zinc-500">Complete the booking details to charge a card.</p>
          )}
        </>
      )}
    </div>
  );
}

function CardCheckout({
  slug,
  payload,
  amountCents,
  onError,
  onDone,
}: {
  slug: string;
  payload: { itemId: string; availabilityId: string; lines: { ct: string; q: number }[]; contact: { name: string; email: string; phone: string } };
  amountCents: number;
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
      <button
        type="button"
        disabled={busy}
        onClick={charge}
        className="w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {busy ? "Charging…" : `Charge ${usd(amountCents)} & book`}
      </button>
    </div>
  );
}

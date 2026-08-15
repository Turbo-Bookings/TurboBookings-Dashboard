import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { BookingActions } from "@/components/BookingActions";
import { LineCheckIn } from "@/components/CheckInControls";
import { RescheduleControls } from "@/components/RescheduleControls";
import { getBookingDetail } from "@/lib/data/bookings";
import { getCancellationRefund } from "@/lib/booking/refund";
import { getTourBookingData } from "@/lib/actions/manualBooking";
import { getLocationBySlug } from "@/lib/data/locations";
import { can } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

function usd(c: number): string {
  return (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

type Props = { params: Promise<{ slug: string; id: string }> };

export default async function BookingDetailPage({ params }: Props) {
  const { slug, id } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();
  const d = await getBookingDetail(id, loc.id);
  if (!d || !d.booking) notFound();
  // Platform processing fee is Turbo-internal revenue — only admins see it.
  const showFees = await can("manage_platform", slug);

  const { booking: b, item, slot, customer, lines, payments, holds, reschedules, fieldValues, activity } = d;
  const refund = await getCancellationRefund(loc.id, id);
  const tourData = b.status === "active" ? await getTourBookingData(slug, b.itemId) : null;
  const rescheduleSlots = tourData && tourData.ok ? tourData.slots : [];
  const tz = loc.timezone ?? "America/Chicago";
  const when = slot
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(slot.startsAt)
    : "—";
  const base = `/locations/${slug}/bookings`;

  return (
    <section className="max-w-3xl">
      <div className="mb-4 flex items-center gap-2 text-xs text-zinc-500">
        <Link href={`${base}/list`} className="hover:text-zinc-700 dark:hover:text-zinc-300">
          All bookings
        </Link>
        <span>/</span>
        <span>#{b.displayNumber}</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            #{b.displayNumber} · {item?.name ?? "Tour"}
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            {when} · {b.source} · <span className="font-medium">{b.status}</span>
          </p>
        </div>
      </div>

      <BookingActions
        slug={slug}
        bookingId={b.id}
        status={b.status}
        refundLabel={refund.label}
        refundCents={refund.refundCents}
        hasCardOnFile={!!d.cardOnFile}
        holds={holds.map((h) => ({
          id: h.hold.id,
          status: h.hold.status,
          amountCents: h.hold.amountCents,
        }))}
      />

      {b.status === "active" && (
        <RescheduleControls
          slug={slug}
          bookingId={b.id}
          currentId={b.availabilityId}
          slots={rescheduleSlots}
          tz={tz}
        />
      )}

      {/* Customer */}
      <div className="mt-5 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Customer</h3>
        <p className="mt-1 text-sm">
          {[customer?.firstName, customer?.lastName].filter(Boolean).join(" ") || "—"}
          {customer?.emailLower ? ` · ${customer.emailLower}` : ""}
          {customer?.phoneE164 ? ` · ${customer.phoneE164}` : ""}
        </p>
      </div>

      {/* Riders + per-vehicle check-in */}
      <div className="mt-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Vehicles</h3>
        <div className="mt-2 space-y-3">
          {lines.map((l) => (
            <div key={l.id}>
              <p className="mb-1 text-xs text-zinc-400">{usd(l.unitPriceCents)} each</p>
              <LineCheckIn
                slug={slug}
                lineId={l.id}
                ctName={l.ctName}
                quantity={l.quantity}
                checkedInUnits={l.checkedInUnits}
                noShowUnits={l.noShowUnits}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Pricing */}
      <div className="mt-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Pricing</h3>
        <dl className="mt-2 space-y-1 text-sm">
          <Row label="Subtotal" value={usd(b.subtotalCents)} />
          {/* Platform fee is Turbo-internal — operators see it bundled with tax
              (as the customer does at checkout); admins see it itemized. */}
          {showFees ? (
            <>
              {b.taxCents > 0 && <Row label="Tax" value={usd(b.taxCents)} />}
              {b.platformFeeCents > 0 && <Row label="Platform fee" value={usd(b.platformFeeCents)} />}
            </>
          ) : (
            (b.taxCents + b.platformFeeCents) > 0 && (
              <Row label="Taxes & fees" value={usd(b.taxCents + b.platformFeeCents)} />
            )
          )}
          {b.discountCents > 0 && <Row label="Discount" value={`-${usd(b.discountCents)}`} />}
          <Row label="Total" value={usd(b.totalCents)} strong />
          <Row label="Paid online" value={usd(b.depositPaidCents)} />
          {b.balanceDueCents > 0 && <Row label="Balance at venue" value={usd(b.balanceDueCents)} muted />}
          {b.refundedCents > 0 && <Row label="Refunded" value={usd(b.refundedCents)} muted />}
        </dl>
      </div>

      {/* Payments */}
      {payments.length > 0 && (
        <div className="mt-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Payments</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {payments.map((p) => (
              <li key={p.id} className="flex justify-between">
                <span>
                  {p.status} · {usd(p.amountCents)}
                  {p.last4 ? ` · ****${p.last4}` : ""}
                  {p.refundedAmountCents > 0 ? ` · refunded ${usd(p.refundedAmountCents)}` : ""}
                </span>
                <span className="font-mono text-xs text-zinc-400">
                  {p.stripePaymentIntentId
                    ? `${p.stripePaymentIntentId.slice(0, 16)}…`
                    : p.paymentGateway}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Security holds */}
      {holds.length > 0 && (
        <div className="mt-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Security holds</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {holds.map((h) => (
              <li key={h.hold.id}>
                {h.hold.status} · {usd(h.hold.amountCents)}
                {h.brand ? ` · ${h.brand} ****${h.last4}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Custom field responses */}
      {fieldValues.length > 0 && (
        <div className="mt-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Details</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {fieldValues.map((f, i) => (
              <li key={i} className="flex justify-between gap-4">
                <span className="text-zinc-500">{f.label}</span>
                <span className="text-right">
                  {f.kind === "checkbox"
                    ? f.valueChecked
                      ? "Yes"
                      : "No"
                    : f.kind === "quantity"
                      ? String(f.valueQuantity ?? 0)
                      : f.kind === "dropdown"
                        ? f.valueDropdownSelected ?? "—"
                        : f.valueText ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Reschedule history */}
      {reschedules.length > 0 && (
        <div className="mt-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Reschedule history</h3>
          <ul className="mt-2 space-y-1 text-xs text-zinc-500">
            {reschedules.map((r) => (
              <li key={r.id}>
                Moved {r.reason ? `(${r.reason})` : ""}{" "}
                {r.feeChargedCents > 0 ? `· fee ${usd(r.feeChargedCents)}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Activity log */}
      {activity.length > 0 && (
        <div className="mt-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Activity</h3>
          <ul className="mt-2 space-y-1 text-xs text-zinc-500">
            {activity.map((a) => (
              <li key={a.id}>
                {DateTime.fromJSDate(a.createdAt).setZone(tz).toFormat("LLL d, h:mm a")} — {a.summary}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Row({
  label,
  value,
  strong,
  muted,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex justify-between">
      <dt className={muted ? "text-zinc-400" : "text-zinc-600 dark:text-zinc-300"}>{label}</dt>
      <dd className={strong ? "font-semibold" : muted ? "text-zinc-400" : ""}>{value}</dd>
    </div>
  );
}

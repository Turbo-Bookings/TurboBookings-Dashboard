import Link from "next/link";
import { usd } from "@/lib/ui/money";
import { customerBreakdown } from "@/lib/booking/breakdown";
import { sourceLabel } from "@/lib/bookingSource";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { BookingActions } from "@/components/BookingActions";
import { BookingStamps } from "@/components/BookingStamps";
import { CustomerEditor } from "@/components/CustomerEditor";
import { LineCheckIn } from "@/components/CheckInControls";
import { RescheduleControls } from "@/components/RescheduleControls";
import { getBookingDetail } from "@/lib/data/bookings";
import { getCancellationRefund, stripeRefundableCents } from "@/lib/booking/refund";
import { getTourBookingData } from "@/lib/actions/manualBooking";
import { getLocationBySlug } from "@/lib/data/locations";
import { can } from "@/lib/auth/roles";
import { BookingNote } from "@/components/BookingNote";
import { labelFor, resolveUserLabels } from "@/lib/users";
import { CollectBalance } from "@/components/CollectBalance";
import { getBalanceQuote } from "@/lib/actions/collectBalance";
import { stripePublishableKey } from "@/lib/stripe/client";

export const dynamic = "force-dynamic";


type Props = { params: Promise<{ slug: string; id: string }> };

export default async function BookingDetailPage({ params }: Props) {
  const { slug, id } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();
  const d = await getBookingDetail(id, loc.id);
  if (!d || !d.booking) notFound();
  const canManage = await can("manage_bookings", slug);

  const { booking: b, item, slot, customer, lines, payments, holds, reschedules, fieldValues, activity } = d;
  const refund = await getCancellationRefund(loc.id, id);
  const tourData = b.status === "active" ? await getTourBookingData(slug, b.itemId) : null;
  // What the desk would charge if the customer pays the rest by card. Null when there is nothing to
  // collect, or the caller cannot take payments — the component then renders nothing.
  const balanceQuote = canManage ? await getBalanceQuote(slug, id) : null;
  // "Who changed this booking" is the entire reason audit rows carry a user id, and the history has
  // been rendering the timestamp and the summary while dropping the one column that answers it.
  // Resolved in one batch — fifty rows written by three people is three Clerk lookups.
  const actors = await resolveUserLabels([
    ...activity.map((a) => a.userId),
    ...reschedules.map((r) => r.performedByUserId),
  ]);
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
            {when} · {sourceLabel(b.source)} · <span className="font-medium">{b.status}</span>
          </p>
          <BookingStamps createdAt={d.createdAt} cancelledAt={d.cancelledAt} tz={tz} />
        </div>
      </div>

      <BookingNote
        slug={slug}
        bookingId={b.id}
        note={b.notes}
        canEdit={canManage}
      />

      <BookingActions
        slug={slug}
        bookingId={b.id}
        status={b.status}
        refundLabel={refund.label}
        refundCents={refund.refundCents}
        refundableCents={stripeRefundableCents(d.payments)}
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
        <div className="mt-1">
          <CustomerEditor
            slug={slug}
            bookingId={b.id}
            firstName={customer?.firstName ?? null}
            lastName={customer?.lastName ?? null}
            email={customer?.emailLower ?? null}
            phone={customer?.phoneE164 ?? null}
            canEdit={canManage}
          />
        </div>
      </div>

      {/* Riders + per-vehicle check-in */}
      <div className="mt-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Vehicles</h3>
        <div className="mt-2 space-y-3">
          {lines.map((l) => (
            <div key={l.id}>
              {/* Quantity was missing entirely — a two-ATV booking read "$150.00 each · Double Rider
                  ATV" with nothing saying there were two of them. The modal has always shown it. */}
              <p className="mb-1 text-xs text-zinc-400">
                <span className="font-medium text-zinc-600 dark:text-zinc-300">
                  {l.quantity} × {l.ctName}
                </span>{" "}
                @ {usd(l.unitPriceCents)} each
              </p>
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
          {/* The CUSTOMER's breakdown, matching their confirmation and the modal. Rows come from
              `customerBreakdown` so the two surfaces cannot drift and the lines always reconcile
              against the total — our processing fee is never split out for anyone. */}
          {customerBreakdown(b).map((r) => (
            <Row
              key={r.label}
              label={r.label}
              value={`${r.negative ? "-" : ""}${usd(r.cents)}`}
              strong={r.strong}
              muted={r.muted}
            />
          ))}
        </dl>
      </div>

      {balanceQuote && !("error" in balanceQuote) && (
        <CollectBalance
          slug={slug}
          quote={balanceQuote}
          publishableKey={stripePublishableKey()}
          stripeAccount={loc.stripeAccountId ?? null}
        />
      )}

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
                <span className="tabular-nums">
                  {DateTime.fromJSDate(r.createdAt).setZone(tz).toFormat("LLL d, h:mm a")}
                </span>{" "}
                — Moved by{" "}
                <span className="font-medium text-zinc-600 dark:text-zinc-300">
                  {labelFor(actors, r.performedByUserId).name}
                </span>
                {r.reason ? ` · ${r.reason}` : ""}
                {r.feeChargedCents > 0 ? ` · fee ${usd(r.feeChargedCents)}` : ""}
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
                <span className="tabular-nums">
                  {DateTime.fromJSDate(a.createdAt).setZone(tz).toFormat("LLL d, h:mm a")}
                </span>{" "}
                <span className="font-medium text-zinc-600 dark:text-zinc-300">
                  {labelFor(actors, a.userId).name}
                </span>{" "}
                — {a.summary}
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

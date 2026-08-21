// Deliberately NOT marked `server-only`: the FareHarbor importer CLI arms
// reminders through this, and `server-only` throws outside the Next runtime.
// App code should import from ./notifyManualBookingEmails, which re-exports
// this behind the guard.
//
// Fire-and-forget trigger to the booking app so an operator/manual booking
// (card / Groupon / OTA / walk-in) gets the same confirmation email + scheduled
// reminders as an online booking. The booking app owns the Resend module and
// templates; we just poke its authenticated internal endpoint by bookingId
// (shared DB, so it reads everything it needs). Best-effort: never throws into
// the caller, and no-ops silently until INTERNAL_API_SECRET is set in both
// projects (mirrors the "unset = no-op" convention used for RESEND_API_KEY).
//
// `parts` is optional; omitted means the full lifecycle (confirmation +
// reminders + review), so the manual-booking callers are unchanged. The
// FareHarbor importer passes { confirmation: false, review: false } so migrated
// bookings get reminders only — the customer already holds FareHarbor's
// confirmation and never booked through us.
export type LifecycleParts = {
  confirmation?: boolean;
  reminders?: boolean;
  review?: boolean;
};

/**
 * Ask the booking app to schedule a booking's lifecycle emails.
 *
 * Returns whether the request actually succeeded. It used to return void and
 * swallow everything, which meant a caller could not tell "scheduled 317
 * reminders" from "did nothing at all" — and on 2026-08-21 the import script
 * reported arming reminders for 317 Houston bookings while `INTERNAL_API_SECRET`
 * was empty locally and not one was created. Silence is fine for a fire-and-
 * forget side effect during checkout; it is not fine for a bulk operation whose
 * whole purpose is the side effect.
 */
export async function notifyManualBookingEmails(
  bookingId: string,
  parts?: LifecycleParts,
): Promise<boolean> {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    console.error(
      "notifyManualBookingEmails: INTERNAL_API_SECRET is not set — no email was scheduled",
      { bookingId },
    );
    return false;
  }
  const base = process.env.BOOKING_APP_URL ?? "https://book.turbobookings.net";
  try {
    const res = await fetch(`${base}/api/internal/booking-emails`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(parts ? { bookingId, parts } : { bookingId }),
    });
    if (!res.ok) {
      console.error("notifyManualBookingEmails: booking app returned", res.status, {
        bookingId,
      });
      return false;
    }
    return true;
  } catch (err) {
    console.error("notifyManualBookingEmails failed", { bookingId, err });
    return false;
  }
}

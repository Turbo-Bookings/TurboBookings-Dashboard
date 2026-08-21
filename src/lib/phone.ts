/**
 * Phone normalization, shared by every path that writes `customers.phone_e164`.
 *
 * The column has always been NAMED phone_e164, but until now the checkout wrote
 * whatever the customer typed straight into it. A US customer typing
 * "786-223-8995" was stored as "7862238995", and both the browser pixel and the
 * server CAPI hash `phone.replace(/\D/g,"")` — so Meta received a hash of a
 * 10-digit number with NO country code. Meta normalizes to digits-WITH-country-
 * code before matching, so those hashes matched nothing and quietly dragged
 * event match quality down. Same value feeds Google's enhanced conversions,
 * which wants E.164 outright.
 *
 * Storing E.164 fixes both consumers at once and needs no change to either
 * hashing site: stripping non-digits from "+17862238995" yields exactly the
 * "17862238995" Meta expects.
 */

/**
 * US-centric E.164 normalization. Returns null rather than guessing when the
 * digits don't look like a phone number — a wrong number on a manifest is worse
 * than a blank one.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const digits = s.replace(/[^\d]/g, "");
  if (s.startsWith("+")) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/**
 * What to persist. Prefers E.164, but falls back to the raw input rather than
 * dropping it: an operator still has to be able to phone the customer about an
 * unparseable international number. Only the ad-platform hashing is strict —
 * see `isE164` — because there a non-matching hash is worse than no hash.
 */
export function phoneForStorage(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  return normalizePhone(trimmed) ?? trimmed;
}

/** True when a stored value carries a country code, so it is safe to hash. */
export function isE164(v: string | null | undefined): boolean {
  return typeof v === "string" && /^\+\d{8,15}$/.test(v.trim());
}

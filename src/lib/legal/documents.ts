/**
 * The document registry — plain data, deliberately free of `server-only` so a
 * CLI script (and, later, a public terms page) can read it without dragging in
 * the database and Clerk. The server-side acceptance logic lives in ./terms.ts.
 *
 * `version: null` means NOT PUBLISHED YET — nothing is enforced and nobody is
 * gated. That is deliberate: the machinery ships now so the first operator to
 * onboard is recorded properly, but the wording is still with a lawyer. Putting
 * a placeholder agreement in front of Richard's staff would be worse than
 * having none — they would "accept" text we then replace, and the record would
 * be of the wrong thing.
 *
 * TO GO LIVE: set `version` to the effective date of the drafted text and point
 * `url` at the published page.
 *
 * Bumping the version asks everyone again — that is the mechanism behind an
 * amendment clause. FareHarbor commits to 15 days' notice before a change takes
 * effect; whatever notice period counsel lands on, the version bump is how it
 * gets enforced, so do not bump it silently.
 */
export type LegalDocument = {
  key: string;
  title: string;
  /** null = not published; nothing is gated. */
  version: string | null;
  url: string | null;
};

export const OPERATOR_AGREEMENT: LegalDocument = {
  key: "operator_agreement",
  title: "Turbo Bookings Operator Agreement",
  version: null,
  url: null,
};

/** Documents gated at dashboard sign-in. */
export const GATED_DOCUMENTS: LegalDocument[] = [OPERATOR_AGREEMENT];

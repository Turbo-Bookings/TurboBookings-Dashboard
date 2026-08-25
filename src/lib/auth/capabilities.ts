// The role ladder and the capability map, as plain data.
//
// Deliberately NOT `server-only`: the client-side capability provider needs the same shape and the
// same all-false default, and duplicating either is how they drift. Everything that touches Clerk or
// the database lives in `./roles.ts`, which imports from here.

// 5 fixed roles (ranked — a role has every capability at or below it):
//   master      — Turbo owner; GLOBAL, cross-location, sees everything incl. fee
//   admin       — Turbo team;  GLOBAL, full access to every location incl. fee/marketing
//   operator    — location client; PER-LOCATION; their product but not fee/marketing
//   director    — manager / sales rep; PER-LOCATION; manifest + bookings + refunds + reports
//   basic_user  — front-line staff; PER-LOCATION; manifest + bookings + check-in
export const ROLES = ["master", "admin", "operator", "director", "basic_user"] as const;
export type Role = (typeof ROLES)[number];

export const RANK: Record<Role, number> = {
  basic_user: 0,
  director: 1,
  operator: 2,
  admin: 3,
  master: 4,
};

// Which roles are valid as a GLOBAL assignment vs a PER-LOCATION assignment.
export const GLOBAL_ROLES = new Set<Role>(["master", "admin"]);
export const LOCATION_ROLES = new Set<Role>(["operator", "director", "basic_user"]);

// Capability → minimum role. Gate mutations on these, not on raw role checks.
export type Capability =
  | "checkin" // basic_user+
  | "collect_payment" // basic_user+ (take the balance on a card at the desk)
  | "view_revenue" // director+ (see the note below — TOTALS, not a booking's own figures)
  | "manage_bookings" // director+ (create/reschedule)
  | "refund" // director+ (cancel/refund/holds)
  | "manage_config" // operator+ (catalog, Stripe, taxes, branding, emails, reviews)
  | "manage_team" // operator+ (invite/manage this location's staff)
  | "manage_platform"; // admin+ (processing fee, marketing tracking, secrets, setup)

export const CAP_MIN: Record<Capability, Role> = {
  checkin: "basic_user",
  // Front-line staff collect the balance at the desk — that is the job. Named separately from
  // `checkin` rather than folded into it so "may mark a rider present" and "may charge $400 to a
  // card" do not become the same permission forever; tightening one later should not require
  // untangling the other.
  collect_payment: "basic_user",
  view_revenue: "director",
  manage_bookings: "director",
  refund: "director",
  manage_config: "operator",
  manage_team: "operator",
  manage_platform: "admin",
};

/**
 * `view_revenue` vs a booking's own money — the distinction is the whole point, so it is written down
 * once rather than re-reasoned at each call site.
 *
 * Front-line staff COLLECT money: the desk has to see that booking #0412 owes $180 and be able to
 * take the card, or it cannot do its job. What it must not see is anything SUMMED across bookings —
 * the day's revenue, what the venue is holding, a report.
 *
 *   per-booking figure  → `checkin`      (balance due, total, the Collect balance form)
 *   anything aggregated → `view_revenue` (dashboard sales tiles, every report, any column footer)
 *
 * It is its own capability rather than a reuse of `manage_bookings` because the bookings PAGE is now
 * readable at `checkin`, so "may manage bookings" can no longer double as "may see totals".
 */
export const CAPABILITY_LIST = Object.keys(CAP_MIN) as Capability[];

export type Capabilities = Record<Capability, boolean>;

/**
 * Every capability false. The safe default everywhere — a role we do not recognise, a user with no
 * role here, a client component rendered outside the provider.
 *
 * Derived rather than written out: the hand-maintained version had to be edited in three places
 * whenever a capability was added, and the third place was a client-side default where a missing key
 * would have read as `undefined` — falsy, so still safe, but silently so.
 */
export const NO_CAPS: Capabilities = Object.fromEntries(
  CAPABILITY_LIST.map((c) => [c, false]),
) as Capabilities;

/** Resolve every capability for a rank on the ladder. */
export function capabilitiesForRank(rank: number): Capabilities {
  return Object.fromEntries(
    CAPABILITY_LIST.map((c) => [c, rank >= RANK[CAP_MIN[c]]]),
  ) as Capabilities;
}

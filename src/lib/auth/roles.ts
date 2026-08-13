import "server-only";
import { currentUser } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";

// 5 fixed roles (ranked ladder — a role has every capability at or below it):
//   master      — Turbo owner; cross-location, sees everything incl. platform fee
//   admin       — Turbo team; full access to a location incl. fee + marketing
//   operator    — location client; their product (tours/Stripe/taxes/branding/
//                 emails/reviews/bookings) but NOT the platform fee or marketing
//   director    — manager/standard staff; manifest + bookings + refunds + reports
//   basic_user  — front-line staff; manifest + check-in + view-only
// Role is read from Clerk publicMetadata.role. A user with NO valid role has
// no access (fail CLOSED) — they see a "pending" gate, not the dashboard. So
// every real user (including the owner) must be assigned a role in Clerk; this
// prevents a fresh/invited account from silently landing as an admin.
export const ROLES = [
  "master",
  "admin",
  "operator",
  "director",
  "basic_user",
] as const;
export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = {
  basic_user: 0,
  director: 1,
  operator: 2,
  admin: 3,
  master: 4,
};

// The current user's assigned role, or null when they have no valid role yet
// (fail CLOSED). Also null if the auth lookup throws (e.g. mid key-rotation),
// so a transient error never grants access.
export async function getCurrentRole(): Promise<Role | null> {
  try {
    const u = await currentUser();
    const r = u?.publicMetadata?.role as string | undefined;
    return r && (ROLES as readonly string[]).includes(r) ? (r as Role) : null;
  } catch {
    return null;
  }
}

// True once the user has any valid assigned role (used by the pending gate).
export async function hasAssignedRole(): Promise<boolean> {
  return (await getCurrentRole()) !== null;
}

export async function hasRole(min: Role): Promise<boolean> {
  const r = await getCurrentRole();
  return r !== null && RANK[r] >= RANK[min];
}

// Capability → minimum role. Gate mutations on these, not on raw role checks.
export type Capability =
  | "checkin" // basic_user+
  | "manage_bookings" // director+ (create/reschedule)
  | "refund" // director+ (cancel/refund/holds)
  | "manage_config" // operator+ (their location: catalog, Stripe, taxes,
  //   branding, emails, reviews, discounts, policies, activity)
  | "manage_platform"; // admin+ (Turbo-only: processing/platform fee,
//   marketing tracking, integration secrets, setup checklist)

const CAP_MIN: Record<Capability, Role> = {
  checkin: "basic_user",
  manage_bookings: "director",
  refund: "director",
  manage_config: "operator",
  manage_platform: "admin",
};

export async function can(cap: Capability): Promise<boolean> {
  return hasRole(CAP_MIN[cap]);
}

// Returns null when allowed, or an error string when denied.
export async function denyIfCannot(cap: Capability): Promise<string | null> {
  return (await can(cap)) ? null : "You don't have permission for this action.";
}

// Throwing variant — for server actions that return void and for page guards,
// where there's no result shape to carry the deny message. UI hiding means this
// is a defense-in-depth path a correctly-scoped user never hits.
export async function assertCan(cap: Capability): Promise<void> {
  if (!(await can(cap))) throw new Error("You don't have permission for this action.");
}

// Server-component / layout guard for a whole route subtree — 404s the page for
// a user who lacks the capability (defense-in-depth behind the hidden nav).
export async function requirePageCapability(cap: Capability): Promise<void> {
  if (!(await can(cap))) notFound();
}

export type Capabilities = Record<Capability, boolean>;

const NO_CAPS: Capabilities = {
  checkin: false,
  manage_bookings: false,
  refund: false,
  manage_config: false,
  manage_platform: false,
};

// Resolve all capabilities for the current user in one shot (single role read).
// A role-less user gets nothing (fail closed).
export async function getCapabilities(): Promise<Capabilities> {
  const role = await getCurrentRole();
  if (role === null) return NO_CAPS;
  const rank = RANK[role];
  return {
    checkin: rank >= RANK[CAP_MIN.checkin],
    manage_bookings: rank >= RANK[CAP_MIN.manage_bookings],
    refund: rank >= RANK[CAP_MIN.refund],
    manage_config: rank >= RANK[CAP_MIN.manage_config],
    manage_platform: rank >= RANK[CAP_MIN.manage_platform],
  };
}

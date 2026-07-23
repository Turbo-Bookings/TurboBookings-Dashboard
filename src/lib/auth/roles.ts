import "server-only";
import { currentUser } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";

// 4 fixed roles (locked design, custom-booking-system-exploration §0.7):
//   master      — operator + team; cross-location admin
//   admin       — client; full access for their location (config, etc.)
//   director    — manager; manifest + bookings + refunds + reports
//   basic_user  — front-line staff; manifest + check-in + view-only
// Role is read from Clerk publicMetadata.role. Until a user is explicitly
// assigned a role, they default to "master" so the owner is never locked out;
// assigning a lower role (in the Clerk dashboard) activates enforcement.
export const ROLES = ["master", "admin", "director", "basic_user"] as const;
export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = {
  basic_user: 0,
  director: 1,
  admin: 2,
  master: 3,
};

export async function getCurrentRole(): Promise<Role> {
  try {
    const u = await currentUser();
    const r = u?.publicMetadata?.role as string | undefined;
    return r && (ROLES as readonly string[]).includes(r) ? (r as Role) : "master";
  } catch {
    return "master";
  }
}

export async function hasRole(min: Role): Promise<boolean> {
  return RANK[await getCurrentRole()] >= RANK[min];
}

// Capability → minimum role. Gate mutations on these, not on raw role checks.
export type Capability =
  | "checkin" // basic_user+
  | "manage_bookings" // director+ (create/reschedule)
  | "refund" // director+ (cancel/refund/holds)
  | "manage_config"; // admin+ (discounts, policies, custom fields)

const CAP_MIN: Record<Capability, Role> = {
  checkin: "basic_user",
  manage_bookings: "director",
  refund: "director",
  manage_config: "admin",
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

// Resolve all capabilities for the current user in one shot (single role read).
export async function getCapabilities(): Promise<Capabilities> {
  const role = await getCurrentRole();
  const rank = RANK[role];
  return {
    checkin: rank >= RANK[CAP_MIN.checkin],
    manage_bookings: rank >= RANK[CAP_MIN.manage_bookings],
    refund: rank >= RANK[CAP_MIN.refund],
    manage_config: rank >= RANK[CAP_MIN.manage_config],
  };
}

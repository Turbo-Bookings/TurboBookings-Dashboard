import "server-only";
import { cache } from "react";
import { currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getDb, locations } from "@/lib/db";
import {
  CAP_MIN,
  GLOBAL_ROLES,
  LOCATION_ROLES,
  NO_CAPS,
  RANK,
  ROLES,
  capabilitiesForRank,
  type Capabilities,
  type Capability,
  type Role,
} from "@/lib/auth/capabilities";

// The ladder itself is plain data in ./capabilities so the client-side provider can share it.
// Re-exported here because most of the app imports these from this module.
export { ROLES, CAP_MIN, NO_CAPS };
export type { Role, Capability, Capabilities };

type PublicMeta = {
  role?: unknown;
  locationRoles?: Record<string, unknown>;
};

function asRole(r: unknown, allowed: Set<Role>): Role | null {
  return typeof r === "string" && allowed.has(r as Role) ? (r as Role) : null;
}

// The current user's publicMetadata, cached per request. Null on any auth error
// (fail closed — a transient failure never grants access).
const getMeta = cache(async (): Promise<PublicMeta | null> => {
  try {
    const u = await currentUser();
    return (u?.publicMetadata ?? {}) as PublicMeta;
  } catch {
    return null;
  }
});

// slug → location id, cached per request (many checks resolve the same slug).
const locationIdForSlug = cache(async (slug: string): Promise<string | null> => {
  const row = (
    await getDb()
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.slug, slug))
      .limit(1)
  )[0];
  return row?.id ?? null;
});

// The user's GLOBAL role (master/admin), or null.
export async function getGlobalRole(): Promise<Role | null> {
  const meta = await getMeta();
  return meta ? asRole(meta.role, GLOBAL_ROLES) : null;
}

// The user's EFFECTIVE role at a location: a global master/admin applies
// everywhere; otherwise their per-location role; otherwise null (no access).
export async function getRoleForLocation(slug: string): Promise<Role | null> {
  const meta = await getMeta();
  if (!meta) return null;
  const global = asRole(meta.role, GLOBAL_ROLES);
  if (global) return global;
  const locId = await locationIdForSlug(slug);
  if (!locId) return null;
  return asRole(meta.locationRoles?.[locId], LOCATION_ROLES);
}

// True if the user has any role anywhere (global OR at any location) — used by
// the app-wide "pending" gate on cross-location surfaces (home, new-location).
export async function hasAssignedRoleAnywhere(): Promise<boolean> {
  const meta = await getMeta();
  if (!meta) return false;
  if (asRole(meta.role, GLOBAL_ROLES)) return true;
  const lr = meta.locationRoles ?? {};
  return Object.values(lr).some((r) => asRole(r, LOCATION_ROLES) !== null);
}

// True if the user has any role AT this location — used by the per-location gate.
export async function hasRoleForLocation(slug: string): Promise<boolean> {
  return (await getRoleForLocation(slug)) !== null;
}

// Does the user meet `min` AT this location?
async function rankAtLeast(min: Role, slug: string): Promise<boolean> {
  const r = await getRoleForLocation(slug);
  return r !== null && RANK[r] >= RANK[min];
}

export async function can(cap: Capability, slug: string): Promise<boolean> {
  return rankAtLeast(CAP_MIN[cap], slug);
}

// Returns null when allowed, or an error string when denied.
export async function denyIfCannot(
  cap: Capability,
  slug: string,
): Promise<string | null> {
  return (await can(cap, slug))
    ? null
    : "You don't have permission for this action.";
}

// Throwing variant — for void-returning server actions.
export async function assertCan(cap: Capability, slug: string): Promise<void> {
  if (!(await can(cap, slug)))
    throw new Error("You don't have permission for this action.");
}

// Server-component / layout guard for a whole route subtree at a location.
export async function requirePageCapability(
  cap: Capability,
  slug: string,
): Promise<void> {
  if (!(await can(cap, slug))) notFound();
}

// All capabilities for the current user AT a location, in one shot. Role-less
// at this location → nothing (fail closed).
export async function getCapabilities(slug: string): Promise<Capabilities> {
  const role = await getRoleForLocation(slug);
  if (role === null) return NO_CAPS;
  return capabilitiesForRank(RANK[role]);
}

// ---- Cross-location (global) helpers ----

// Only Turbo team (master/admin) can create locations.
export async function canCreateLocation(): Promise<boolean> {
  return (await getGlobalRole()) !== null;
}

// Which locations the user may see. "all" for global master/admin; otherwise
// the location ids they hold a per-location role at.
export async function accessibleLocationIds(): Promise<"all" | string[]> {
  const meta = await getMeta();
  if (!meta) return [];
  if (asRole(meta.role, GLOBAL_ROLES)) return "all";
  const lr = meta.locationRoles ?? {};
  return Object.keys(lr).filter((id) => asRole(lr[id], LOCATION_ROLES) !== null);
}

// The roles the current actor may GRANT at a location (the ceiling): master
// grants anything; admin grants up to admin (not master); operator grants only
// director/basic_user. Others grant nothing.
export async function assignableRoles(slug: string): Promise<Role[]> {
  const r = await getRoleForLocation(slug);
  if (r === "master") return ["master", "admin", "operator", "director", "basic_user"];
  if (r === "admin") return ["admin", "operator", "director", "basic_user"];
  if (r === "operator") return ["director", "basic_user"];
  return [];
}

// Whether a role is a global vs per-location assignment (used by the Team
// actions to route the write to publicMetadata.role vs locationRoles).
export function isGlobalRole(r: Role): boolean {
  return GLOBAL_ROLES.has(r);
}

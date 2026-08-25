"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, locations } from "@/lib/db";
import {
  assignableRoles,
  denyIfCannot,
  isGlobalRole,
  type Role,
} from "@/lib/auth/roles";

// Team management via Clerk's Backend API. Per-location roles live in
// publicMetadata.locationRoles[locationId]; global (master/admin) in
// publicMetadata.role. The Team page (settings/team) is gated by manage_team;
// every grant is re-checked here against the actor's ceiling (assignableRoles).

type Meta = { role?: unknown; locationRoles?: Record<string, unknown> };
const GLOBAL = new Set<Role>(["master", "admin"]);
const SCOPED = new Set<Role>(["operator", "director", "basic_user"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function locationIdBySlug(slug: string): Promise<string | null> {
  const row = (
    await getDb()
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.slug, slug))
      .limit(1)
  )[0];
  return row?.id ?? null;
}

function globalRoleOf(meta: Meta): Role | null {
  return typeof meta.role === "string" && GLOBAL.has(meta.role as Role)
    ? (meta.role as Role)
    : null;
}
function scopedRoleOf(meta: Meta, locId: string): Role | null {
  const r = meta.locationRoles?.[locId];
  return typeof r === "string" && SCOPED.has(r as Role) ? (r as Role) : null;
}

export type TeamMember = {
  userId: string;
  email: string;
  name: string;
  role: Role;
  isGlobal: boolean;
};

// Everyone with access to this location: per-location role holders + global
// master/admin (who can access every location).
export async function getTeamForLocation(slug: string): Promise<TeamMember[]> {
  // A `"use server"` export is a POST endpoint and the CALLER supplies the identifier, so scoping
  // the query is not access control — it only decides whose data comes back. Without this, any
  // signed-in user could read this for any location by passing a different one.
  if (await denyIfCannot("manage_team", slug)) return [];
  const locId = await locationIdBySlug(slug);
  if (!locId) return [];
  const client = await clerkClient();
  const { data } = await client.users.getUserList({ limit: 200 });
  const members: TeamMember[] = [];
  for (const u of data) {
    const meta = (u.publicMetadata ?? {}) as Meta;
    const g = globalRoleOf(meta);
    const role = g ?? scopedRoleOf(meta, locId);
    if (!role) continue;
    const email =
      u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId)
        ?.emailAddress ??
      u.emailAddresses[0]?.emailAddress ??
      "(no email)";
    members.push({
      userId: u.id,
      email,
      name: [u.firstName, u.lastName].filter(Boolean).join(" "),
      role,
      isGlobal: g !== null,
    });
  }
  return members;
}

export type PendingInvite = { id: string; email: string; role: Role };

// Pending invitations relevant to this location (carry a locationRole here, or
// a global role).
export async function getPendingInvitesForLocation(
  slug: string,
): Promise<PendingInvite[]> {
  // A `"use server"` export is a POST endpoint and the CALLER supplies the identifier, so scoping
  // the query is not access control — it only decides whose data comes back. Without this, any
  // signed-in user could read this for any location by passing a different one.
  if (await denyIfCannot("manage_team", slug)) return [];
  const locId = await locationIdBySlug(slug);
  if (!locId) return [];
  const client = await clerkClient();
  const { data } = await client.invitations.getInvitationList({
    status: "pending",
  });
  const out: PendingInvite[] = [];
  for (const inv of data) {
    const meta = (inv.publicMetadata ?? {}) as Meta;
    const role = globalRoleOf(meta) ?? scopedRoleOf(meta, locId);
    if (!role) continue;
    out.push({ id: inv.id, email: inv.emailAddress, role });
  }
  return out;
}

export type TeamResult = { ok: true } | { ok: false; error: string };

// Assign a role to a user at this location (or globally for master/admin). If
// the email isn't a user yet, send a Clerk invitation carrying the role so it's
// applied automatically on sign-up.
export async function assignRole(
  slug: string,
  email: string,
  role: Role,
): Promise<TeamResult> {
  const deny = await denyIfCannot("manage_team", slug);
  if (deny) return { ok: false, error: deny };
  if (!(await assignableRoles(slug)).includes(role))
    return { ok: false, error: "You can't assign that role." };

  const emailNorm = email.trim().toLowerCase();
  if (!EMAIL_RE.test(emailNorm))
    return { ok: false, error: "Enter a valid email address." };
  const locId = await locationIdBySlug(slug);
  if (!locId) return { ok: false, error: "Location not found." };

  const client = await clerkClient();
  const { data: found } = await client.users.getUserList({
    emailAddress: [emailNorm],
    limit: 1,
  });

  if (found.length) {
    const target = found[0];
    const { userId: actorId } = await auth();
    if (target.id === actorId)
      return { ok: false, error: "You can't change your own role." };
    const meta = (target.publicMetadata ?? {}) as Meta;

    // Check what they ARE, not only what you are granting them.
    //
    // `assignableRoles` was applied to the incoming role and nothing else, so an operator could
    // demote a peer operator to director or basic_user — stripping their `manage_config` and
    // `manage_team` — while being explicitly blocked from REMOVING that same person a few lines
    // below. Demoting someone out of their own permissions is removal by another name, and the
    // asymmetry between the two paths was the giveaway that it was unintended.
    const allowedHere = await assignableRoles(slug);
    const currentGlobal = globalRoleOf(meta);
    const currentLocal = (meta.locationRoles ?? {})[locId] as Role | undefined;
    const current = currentGlobal ?? currentLocal;
    if (current && !allowedHere.includes(current)) {
      return { ok: false, error: "You can't change that member's role." };
    }

    const next: Meta = { ...meta };
    if (isGlobalRole(role)) {
      next.role = role;
    } else {
      next.locationRoles = { ...(meta.locationRoles ?? {}), [locId]: role };
    }
    await client.users.updateUser(target.id, {
      publicMetadata: next as Record<string, unknown>,
    });
  } else {
    const publicMetadata: Record<string, unknown> = isGlobalRole(role)
      ? { role }
      : { locationRoles: { [locId]: role } };
    await client.invitations.createInvitation({
      emailAddress: emailNorm,
      publicMetadata,
      ignoreExisting: true,
    });
  }
  revalidatePath(`/locations/${slug}/settings/team`);
  return { ok: true };
}

// Remove a member's access to this location (or their global role). Ceiling +
// anti-lockout enforced.
export async function removeMember(
  slug: string,
  userId: string,
): Promise<TeamResult> {
  const deny = await denyIfCannot("manage_team", slug);
  if (deny) return { ok: false, error: deny };
  const { userId: actorId } = await auth();
  if (userId === actorId)
    return { ok: false, error: "You can't remove yourself." };
  const locId = await locationIdBySlug(slug);
  if (!locId) return { ok: false, error: "Location not found." };

  const client = await clerkClient();
  const target = await client.users.getUser(userId);
  const meta = (target.publicMetadata ?? {}) as Meta;
  const allowed = await assignableRoles(slug);
  const g = globalRoleOf(meta);

  if (g) {
    if (!allowed.includes(g))
      return { ok: false, error: "You can't remove that member." };
    if (g === "master") {
      const { data } = await client.users.getUserList({ limit: 200 });
      const masters = data.filter(
        (u) => (u.publicMetadata as Meta)?.role === "master",
      );
      if (masters.length <= 1)
        return { ok: false, error: "You can't remove the last owner." };
    }
    const next: Meta = { ...meta };
    delete next.role;
    await client.users.updateUser(userId, {
      publicMetadata: next as Record<string, unknown>,
    });
  } else {
    const lRole = scopedRoleOf(meta, locId);
    if (!lRole || !allowed.includes(lRole))
      return { ok: false, error: "You can't remove that member." };
    const lr = { ...(meta.locationRoles ?? {}) };
    delete lr[locId];
    await client.users.updateUser(userId, {
      publicMetadata: { ...meta, locationRoles: lr } as Record<string, unknown>,
    });
  }
  revalidatePath(`/locations/${slug}/settings/team`);
  return { ok: true };
}

export async function revokeInvitation(
  slug: string,
  invitationId: string,
): Promise<TeamResult> {
  const deny = await denyIfCannot("manage_team", slug);
  if (deny) return { ok: false, error: deny };
  const client = await clerkClient();
  await client.invitations.revokeInvitation(invitationId);
  revalidatePath(`/locations/${slug}/settings/team`);
  return { ok: true };
}

/**
 * Clerk role EXPORT — run this BEFORE the dev → production instance cutover.
 *
 * All RBAC lives in Clerk `publicMetadata` (nothing is mirrored in Postgres),
 * and a production instance starts empty: no users, no grants, no pending
 * invitations. Once you cut over, whatever wasn't exported is gone.
 *
 * Writes a JSON backup of {email → {role, locationRoles}} for every user and
 * pending invitation that carries a role. `locationRoles` keys are Postgres
 * `locations.id` UUIDs, which survive the cutover unchanged — so the backup
 * replays verbatim into the new instance via clerk-import-roles.ts.
 *
 *   npm run clerk:export-roles -- --out=clerk-roles-backup.json
 *
 * Reads CLERK_SECRET_KEY from the environment — point it at the DEV instance
 * (sk_test_…). Read-only: this script never writes to Clerk.
 */
import { writeFileSync } from "node:fs";
import { createClerkClient } from "@clerk/backend";

// Mirrors ROLES in src/lib/auth/roles.ts:18-24. Kept local so this script can
// run standalone against either instance without pulling in `server-only`.
type Role = "master" | "admin" | "operator" | "director" | "basic_user";
const GLOBAL_ROLES = new Set<Role>(["master", "admin"]);
const LOCATION_ROLES = new Set<Role>(["operator", "director", "basic_user"]);

type Meta = { role?: unknown; locationRoles?: Record<string, unknown> };

export type RoleGrant = {
  email: string;
  name: string;
  /** Global dashboard role (master/admin), or null. Readability only. */
  role: Role | null;
  /** Per-location dashboard grants, keyed by `locations.id` UUID. Readability only. */
  locationRoles: Record<string, Role>;
  /**
   * The COMPLETE publicMetadata object, replayed verbatim.
   *
   * This is the authoritative field — do not narrow it to the dashboard's own
   * keys. The ads cockpit (a separate app on this same Clerk instance) stores
   * its permission under `cockpitRole`, where absent means least-privilege, so
   * cherry-picking `role`/`locationRoles` would silently strip the creative
   * director's cockpit access at cutover. Any future app adding its own key is
   * covered for free.
   */
  publicMetadata: Record<string, unknown>;
  /** Where this came from — users are re-invited, invitations re-sent. */
  origin: "user" | "invitation";
  /** Dev-instance user id. Informational only; it does NOT carry over. */
  devUserId?: string;
};

function asRole(r: unknown, allowed: Set<Role>): Role | null {
  return typeof r === "string" && allowed.has(r as Role) ? (r as Role) : null;
}

function grantsFrom(meta: Meta): { role: Role | null; locationRoles: Record<string, Role> } {
  const role = asRole(meta.role, GLOBAL_ROLES);
  const locationRoles: Record<string, Role> = {};
  for (const [locId, raw] of Object.entries(meta.locationRoles ?? {})) {
    const r = asRole(raw, LOCATION_ROLES);
    if (r) locationRoles[locId] = r;
  }
  return { role, locationRoles };
}

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

async function main() {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) throw new Error("CLERK_SECRET_KEY is not set");
  const out = arg("out", "clerk-roles-backup.json");

  const clerk = createClerkClient({ secretKey: secret });
  const grants: RoleGrant[] = [];

  // Users — page through rather than the single limit:200 call the Team page
  // makes (getTeamForLocation, src/lib/actions/team.ts:59), so nothing is
  // silently dropped past the cap.
  let offset = 0;
  const limit = 100;
  for (;;) {
    const { data } = await clerk.users.getUserList({ limit, offset });
    if (data.length === 0) break;
    for (const u of data) {
      const meta = (u.publicMetadata ?? {}) as Record<string, unknown>;
      const { role, locationRoles } = grantsFrom(meta as Meta);
      // Export anyone carrying ANY publicMetadata, not just a dashboard role —
      // a cockpit-only user (cockpitRole, no dashboard role) must survive too.
      if (Object.keys(meta).length === 0) continue;
      const email =
        u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId)?.emailAddress ??
        u.emailAddresses[0]?.emailAddress;
      if (!email) {
        console.warn(`  ! skipping user ${u.id} — no email address on record`);
        continue;
      }
      grants.push({
        email,
        name: [u.firstName, u.lastName].filter(Boolean).join(" "),
        role,
        locationRoles,
        publicMetadata: meta,
        origin: "user",
        devUserId: u.id,
      });
    }
    if (data.length < limit) break;
    offset += limit;
  }

  // Pending invitations — these are lost on cutover and must be re-sent.
  const { data: invites } = await clerk.invitations.getInvitationList({ status: "pending" });
  for (const inv of invites) {
    const meta = (inv.publicMetadata ?? {}) as Record<string, unknown>;
    const { role, locationRoles } = grantsFrom(meta as Meta);
    if (Object.keys(meta).length === 0) continue;
    grants.push({
      email: inv.emailAddress,
      name: "",
      role,
      locationRoles,
      publicMetadata: meta,
      origin: "invitation",
    });
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    // Records which instance this came from, so an accidental replay into the
    // same instance is obvious in review.
    sourcePublishableKeyHint: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.slice(0, 16) ?? null,
    grants,
  };
  writeFileSync(out, JSON.stringify(payload, null, 2) + "\n");

  const masters = grants.filter((g) => g.role === "master");
  console.log(`\nExported ${grants.length} grant(s) → ${out}`);
  console.table(
    grants.map((g) => ({
      email: g.email,
      dashboard: g.role ?? "—",
      locations: Object.keys(g.locationRoles).length,
      cockpitRole: (g.publicMetadata.cockpitRole as string | undefined) ?? "—",
      "other keys": Object.keys(g.publicMetadata)
        .filter((k) => !["role", "locationRoles", "cockpitRole"].includes(k))
        .join(", ") || "—",
      origin: g.origin,
    })),
  );
  if (masters.length === 0) {
    console.warn(
      "\n!! No master found. After cutover you must set publicMetadata.role='master'\n" +
        "   by hand in the Clerk dashboard or nobody can administer anything.",
    );
  } else {
    console.log(`\nmaster account(s) to re-establish first: ${masters.map((m) => m.email).join(", ")}`);
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("export failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  },
);

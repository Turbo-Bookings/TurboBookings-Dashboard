/**
 * Clerk role REPLAY — run this AFTER the production instance exists and you
 * have manually established the first `master` account.
 *
 * Reads the backup written by clerk-export-roles.ts and, for each grant:
 *   - if the email is already a user in the target instance → merge-write
 *     publicMetadata (the same shape assignRole uses, src/lib/actions/team.ts:144)
 *   - otherwise → create a Clerk invitation carrying the role in publicMetadata,
 *     so Clerk copies it onto the user at sign-up (team.ts:151-155)
 *
 *   npm run clerk:import-roles -- --in=clerk-roles-backup.json --dry
 *
 * Reads CLERK_SECRET_KEY — point it at the PRODUCTION instance (sk_live_…).
 * Defaults to a DRY RUN unless --commit is passed.
 *
 * Bootstrap order matters: sign yourself up in the production instance and set
 * publicMetadata.role = "master" by hand FIRST. Role resolution fails closed
 * (src/lib/auth/roles.ts:50-57) and RoleGate blocks anyone with no role, so
 * without a master nobody can administer anything — including re-granting.
 */
import { readFileSync } from "node:fs";
import { createClerkClient } from "@clerk/backend";
import type { RoleGrant } from "./clerk-export-roles";

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const COMMIT = process.argv.includes("--commit");

type Outcome = "updated_user" | "invited" | "skipped_nochange" | "error";

/** Human summary of what a grant carries, for the run table. */
function describe(g: RoleGrant, meta: Record<string, unknown>): string {
  const bits: string[] = [];
  if (meta.role) bits.push(`dashboard:${String(meta.role)}`);
  const locs = Object.keys((meta.locationRoles as Record<string, unknown>) ?? {}).length;
  if (locs) bits.push(`${locs} location(s)`);
  if (meta.cockpitRole) bits.push(`cockpit:${String(meta.cockpitRole)}`);
  const others = Object.keys(meta).filter(
    (k) => !["role", "locationRoles", "cockpitRole"].includes(k),
  );
  if (others.length) bits.push(`+${others.join(",")}`);
  return bits.length ? bits.join(" · ") : "(no metadata)";
}

async function main() {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) throw new Error("CLERK_SECRET_KEY is not set");
  const inPath = arg("in", "clerk-roles-backup.json");

  const parsed = JSON.parse(readFileSync(inPath, "utf8")) as {
    exportedAt: string;
    sourcePublishableKeyHint: string | null;
    grants: RoleGrant[];
  };
  const grants = parsed.grants ?? [];
  if (grants.length === 0) throw new Error(`no grants in ${inPath}`);

  const clerk = createClerkClient({ secretKey: secret });
  const results: { email: string; outcome: Outcome; detail: string }[] = [];

  console.log(
    `\n${COMMIT ? "COMMIT" : "DRY RUN"} — replaying ${grants.length} grant(s) from ${inPath}` +
      `\n  exported: ${parsed.exportedAt}\n`,
  );

  for (const g of grants) {
    // Replay the WHOLE publicMetadata object, not just the dashboard's keys.
    // The ads cockpit reads `cockpitRole` off this same instance and treats an
    // absent value as least-privilege, so narrowing here would quietly demote
    // the creative director. Falls back to the narrow fields for backups taken
    // before the export started capturing the full object.
    const publicMetadata: Record<string, unknown> = { ...(g.publicMetadata ?? {}) };
    if (g.role && publicMetadata.role == null) publicMetadata.role = g.role;
    if (Object.keys(g.locationRoles ?? {}).length && publicMetadata.locationRoles == null) {
      publicMetadata.locationRoles = g.locationRoles;
    }

    try {
      const { data: existing } = await clerk.users.getUserList({
        emailAddress: [g.email],
        limit: 1,
      });
      const user = existing[0];

      if (user) {
        // Merge, don't clobber — preserves onboardingTourV and anything else
        // the app has already written (src/lib/actions/onboarding.ts:19-21).
        const merged = { ...(user.publicMetadata ?? {}), ...publicMetadata };
        if (COMMIT) {
          await clerk.users.updateUser(user.id, { publicMetadata: merged });
        }
        results.push({
          email: g.email,
          outcome: "updated_user",
          detail: describe(g, publicMetadata),
        });
      } else {
        if (COMMIT) {
          await clerk.invitations.createInvitation({
            emailAddress: g.email,
            publicMetadata,
            ignoreExisting: true,
          });
        }
        results.push({
          email: g.email,
          outcome: "invited",
          detail: describe(g, publicMetadata),
        });
      }
    } catch (e) {
      results.push({
        email: g.email,
        outcome: "error",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  console.table(results);
  const errors = results.filter((r) => r.outcome === "error");
  console.log(
    `\n${COMMIT ? "Applied" : "Would apply"}: ` +
      `${results.filter((r) => r.outcome === "updated_user").length} user update(s), ` +
      `${results.filter((r) => r.outcome === "invited").length} invitation(s), ` +
      `${errors.length} error(s).`,
  );
  if (!COMMIT) console.log("\nNothing was written. Re-run with --commit to apply.");
  if (errors.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error("replay failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});

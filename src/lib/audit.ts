import "server-only";
import { auth } from "@clerk/nextjs/server";
import { desc, eq } from "drizzle-orm";
import { auditLog, getDb, locations } from "@/lib/db";
import type { AuditLog } from "@/lib/db/schema";

type RecordOpts = {
  slug: string;
  action: string;
  summary: string;
  payload?: Record<string, unknown>;
};

// Single call site for capturing config changes. Pulls the actor's Clerk
// userId via auth() — null for system-initiated writes (template seeding,
// fork CLI). Failures are swallowed: a missed audit row shouldn't block
// the underlying action from succeeding.
export async function recordAudit({
  slug,
  action,
  summary,
  payload,
}: RecordOpts): Promise<void> {
  try {
    const db = getDb();
    const locRows = await db
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.slug, slug))
      .limit(1);
    if (!locRows[0]) return;

    let userId: string | null = null;
    try {
      const { userId: clerkId } = await auth();
      userId = clerkId ?? null;
    } catch {
      // auth() can throw outside a request context (e.g. when called from
      // a non-action server context). Just skip user attribution.
    }

    await db.insert(auditLog).values({
      locationId: locRows[0].id,
      userId,
      action,
      summary,
      payload,
    });
  } catch (err) {
    console.error("audit recordAudit failed", err);
  }
}

export async function listAuditForLocation(
  locationId: string,
  limit = 100,
): Promise<AuditLog[]> {
  const db = getDb();
  return db
    .select()
    .from(auditLog)
    .where(eq(auditLog.locationId, locationId))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
}

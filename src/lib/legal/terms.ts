import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { auth, currentUser } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { getDb, termsAcceptances } from "@/lib/db";
import { GATED_DOCUMENTS, type LegalDocument } from "@/lib/legal/documents";

export { GATED_DOCUMENTS, OPERATOR_AGREEMENT } from "@/lib/legal/documents";
export type { LegalDocument } from "@/lib/legal/documents";

/**
 * Has this user already accepted the current version?
 *
 * Returns true when the document is unpublished, so an unpublished document can
 * never lock anyone out. Fails OPEN on purpose — the opposite of `RoleGate`,
 * which fails closed. A bug here must never stop an operator running their
 * business; the worst case is being asked to accept twice.
 */
export async function hasAccepted(
  doc: LegalDocument,
  locationId: string | null,
): Promise<boolean> {
  if (!doc.version) return true;
  const { userId } = await auth();
  if (!userId) return true;
  try {
    const rows = await getDb()
      .select({ id: termsAcceptances.id })
      .from(termsAcceptances)
      .where(
        and(
          eq(termsAcceptances.userId, userId),
          eq(termsAcceptances.document, doc.key),
          eq(termsAcceptances.version, doc.version),
          locationId
            ? eq(termsAcceptances.locationId, locationId)
            : isNull(termsAcceptances.locationId),
        ),
      )
      .limit(1);
    return rows.length > 0;
  } catch (e) {
    console.error("[terms] acceptance lookup failed — letting the user through", e);
    return true;
  }
}

/** Documents this user still owes. Empty when nothing is published. */
export async function pendingDocuments(
  locationId: string | null,
): Promise<LegalDocument[]> {
  const out: LegalDocument[] = [];
  for (const doc of GATED_DOCUMENTS) {
    if (!(await hasAccepted(doc, locationId))) out.push(doc);
  }
  return out;
}

/**
 * Record an acceptance. Idempotent — re-accepting the same version does nothing,
 * enforced by a unique index rather than a read-then-write race.
 *
 * The IP and user agent are the point of the exercise. An acceptance without
 * them is a claim; with them it is evidence.
 */
export async function recordAcceptance(
  doc: LegalDocument,
  locationId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!doc.version) return { ok: false, error: "That document isn't published yet." };
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "You need to be signed in." };

  const h = await headers();
  // x-forwarded-for is a comma-separated chain; the client is the first entry.
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || null;
  const ua = h.get("user-agent")?.slice(0, 500) ?? null;

  let email: string | null = null;
  try {
    const u = await currentUser();
    email = u?.primaryEmailAddress?.emailAddress ?? null;
  } catch {
    // An acceptance is still valid without the email snapshot.
  }

  await getDb()
    .insert(termsAcceptances)
    .values({
      userId,
      userEmail: email,
      locationId,
      document: doc.key,
      version: doc.version,
      documentUrl: doc.url,
      ipAddress: ip,
      userAgent: ua,
    })
    .onConflictDoNothing();

  return { ok: true };
}

/** Every acceptance by one user, newest first — for support and for disputes. */
export async function acceptanceHistory(userId: string) {
  return getDb()
    .select()
    .from(termsAcceptances)
    .where(eq(termsAcceptances.userId, userId))
    .orderBy(desc(termsAcceptances.acceptedAt));
}

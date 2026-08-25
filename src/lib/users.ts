import "server-only";
import { cache } from "react";
import { clerkClient } from "@clerk/nextjs/server";

/**
 * Clerk user id → a name a human recognises.
 *
 * Audit rows, reschedule records and `bookings.created_by_user_id` all store a raw Clerk id. Showing
 * `user_2abc…` answers nobody's question — "who changed this booking" is the entire reason the column
 * exists — and the only resolver in the codebase was inlined in `ActivityFeed`, so every other
 * surface that wanted a name simply did not show one.
 *
 * Batched and request-cached: a booking's history can carry fifty rows written by three people, and
 * that must be three lookups, not fifty.
 */

export type UserLabel = { name: string; email: string | null };

/** Written by a cron, a webhook, or the importer rather than a person. */
export const SYSTEM_LABEL: UserLabel = { name: "System", email: null };

async function fetchLabels(ids: string[]): Promise<Map<string, UserLabel>> {
  const out = new Map<string, UserLabel>();
  if (ids.length === 0) return out;
  let clerk;
  try {
    clerk = await clerkClient();
  } catch {
    // Clerk unreachable. A history list is worth showing with weaker labels; it is not worth
    // failing the whole page over.
    for (const id of ids) out.set(id, { name: id.slice(0, 8), email: null });
    return out;
  }
  await Promise.all(
    ids.map(async (id) => {
      try {
        const u = await clerk.users.getUser(id);
        const full = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
        const email = u.primaryEmailAddress?.emailAddress ?? null;
        out.set(id, {
          // Prefer a real name, then the email, then a short id. A deleted user still resolves to
          // something stable rather than vanishing from their own history.
          name: full || u.username || email || id.slice(0, 8),
          email,
        });
      } catch {
        out.set(id, { name: id.slice(0, 8), email: null });
      }
    }),
  );
  return out;
}

/**
 * Resolve a batch of ids. Nulls and duplicates are fine — nulls map to "System", duplicates are
 * fetched once.
 */
export const resolveUserLabels = cache(
  async (ids: (string | null | undefined)[]): Promise<Map<string, UserLabel>> => {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    return fetchLabels(unique);
  },
);

/** Look one id up in a resolved map, with the System fallback applied. */
export function labelFor(
  map: Map<string, UserLabel>,
  id: string | null | undefined,
): UserLabel {
  if (!id) return SYSTEM_LABEL;
  return map.get(id) ?? { name: id.slice(0, 8), email: null };
}

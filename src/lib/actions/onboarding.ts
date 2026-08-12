"use server";

import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { TOUR_VERSION } from "@/components/tour/steps";

// Records that the current user has seen the onboarding tour at the current
// version, so it doesn't auto-launch again (the Help button relaunches it
// regardless). Stored in Clerk publicMetadata — MERGES so we never clobber the
// user's `role`. First (and only) metadata write path in the app.
export async function markTourSeen(): Promise<void> {
  const { userId } = await auth();
  if (!userId) return;
  const user = await currentUser();
  const existing = (user?.publicMetadata ?? {}) as Record<string, unknown>;
  // No-op if already at/above this version.
  if (Number(existing.onboardingTourV ?? 0) >= TOUR_VERSION) return;

  const client = await clerkClient();
  await client.users.updateUser(userId, {
    publicMetadata: { ...existing, onboardingTourV: TOUR_VERSION },
  });
}

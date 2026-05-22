import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Routes that are publicly accessible without a signed-in user. Everything
// else requires auth — the entire dashboard is internal/client-facing and
// has no public-facing surface.
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return;

  // Clerk's auth.protect() defaults to 404 (intentional info-hiding for
  // public APIs). For a dashboard surface we want unauthenticated users
  // sent to sign-in instead. Manual redirect via redirectToSignIn().
  const { userId, redirectToSignIn } = await auth();
  if (!userId) {
    return redirectToSignIn({ returnBackUrl: req.url });
  }
});

export const config = {
  matcher: [
    // Skip Next internals + static assets. Always run on api/trpc routes.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};

import type { Capability, Capabilities } from "@/lib/auth/roles";

// Bump when the tour content changes materially — users whose stored
// onboardingTourV is lower will get it auto-launched once more.
export const TOUR_VERSION = 1;

export type TourStep = {
  id: string;
  // Capability required to SEE this step. null = everyone. Steps the user
  // can't access are filtered out, so the same list yields the full / operator
  // / manager / check-in tours automatically.
  cap: Capability | null;
  // Human-facing card.
  title: string;
  body: string;
  // data-tour anchor to highlight. Omit for a centered modal card.
  target?: string;
  // Route SUFFIX under /locations/{slug} to navigate to before highlighting.
  // null/undefined = stay on the current page (e.g. sidebar-nav steps).
  route?: string | null;
  centered?: boolean;
};

// Ordered master list. Friendly, concise copy.
export const TOUR_STEPS: TourStep[] = [
  { id: "welcome", cap: null, centered: true, title: "Welcome to TurboBookings 👋", body: "Here's a quick tour of your dashboard. Use the arrows to move along — or close it anytime and reopen it later from the Help button." },
  { id: "nav-dashboard", cap: "manage_bookings", target: "nav-dashboard", title: "Dashboard", body: "Your numbers at a glance — bookings, revenue, and today's activity." },
  { id: "dashboard-quick-actions", cap: "manage_bookings", route: "/dashboard", target: "dashboard-quick-actions", title: "Quick actions", body: "Jump straight to the manifest, a new booking, or reports from here." },
  { id: "nav-bookings", cap: "manage_bookings", target: "nav-bookings", title: "Bookings", body: "Every booking on a calendar — browse by day or week." },
  { id: "bookings-new", cap: "manage_bookings", route: "/bookings", target: "bookings-new", title: "Take a booking", body: "Click here to book a guest over the phone or in person." },
  { id: "nav-manifest", cap: "checkin", target: "nav-manifest", title: "Manifest", body: "Your daily run sheet — everyone booked for the day, ready to check in." },
  { id: "manifest-checkin", cap: "checkin", route: "/manifest", target: "manifest-checkin", title: "Check guests in", body: "Tap to mark riders as checked in or a no-show as they arrive." },
  { id: "nav-reports", cap: "manage_bookings", target: "nav-reports", title: "Reports", body: "Pull sales and tax reports for any date range, and export to CSV." },
  { id: "nav-catalog", cap: "manage_config", target: "nav-catalog", title: "Tour Catalog", body: "Where you build your tours — pricing, schedule, capacity, and more." },
  { id: "catalog-new-tour", cap: "manage_config", route: "/catalog/tours", target: "catalog-new-tour", title: "Add a tour", body: "Create a tour here, then set its pricing and schedule." },
  { id: "nav-settings", cap: "manage_config", target: "nav-settings", title: "Settings", body: "Everything else — Stripe payouts, taxes, branding, emails, and reviews." },
  { id: "stripe-connect", cap: "manage_config", route: "/integrations", target: "stripe-connect", title: "Get paid with Stripe", body: "Connect your Stripe account so booking payments land in your bank." },
  { id: "taxes-rate", cap: "manage_config", route: "/settings/taxes-fees", target: "taxes-rate", title: "Taxes", body: "Set your local sales-tax rate for this market." },
  { id: "processing-fee", cap: "manage_platform", route: "/settings/taxes-fees", target: "processing-fee", title: "Processing fee", body: "The platform fee for this location — charged on card payments." },
  { id: "branding", cap: "manage_config", route: "", target: "branding", title: "Your branding", body: "Upload your logo and set your colors, fonts, and photos here." },
  { id: "notifications", cap: "manage_config", route: "/settings/notifications", target: "notifications", title: "Customer emails", body: "Edit the copy for your confirmation, reminder, and review emails." },
  { id: "reviews", cap: "manage_config", route: "/settings/reviews", target: "reviews", title: "Reviews", body: "Show your Google rating on the booking page and set your review-request link." },
  { id: "tracking", cap: "manage_platform", route: "/tracking", target: "tracking", title: "Marketing tracking", body: "Meta Pixel, GA4, and conversion tracking for ad attribution." },
  { id: "setup", cap: "manage_platform", route: "/setup", target: "setup", title: "Go-live checklist", body: "Track the external setup tasks needed to take this location live." },
  { id: "activity", cap: "manage_config", route: "/activity", target: "activity", title: "Activity log", body: "A record of who changed what, so nothing slips by unnoticed." },
  { id: "help-button", cap: null, target: "help-button", title: "Need a refresher?", body: "Replay this tour anytime by clicking Help up here." },
  { id: "finish", cap: null, centered: true, title: "You're all set 🎉", body: "That's the tour! Explore at your own pace — and reach out if you need a hand." },
];

// Steps the given user can see (their role's tour version).
export function stepsForCaps(caps: Capabilities): TourStep[] {
  return TOUR_STEPS.filter((s) => s.cap === null || caps[s.cap]);
}

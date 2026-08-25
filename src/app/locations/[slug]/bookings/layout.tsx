import { requirePageCapability } from "@/lib/auth/roles";

// READ access for anyone who can check people in — front-line staff need to look a booking up, see
// what it owes, and take the card at the desk. Every WRITE inside is separately gated:
// `bookings/new` requires `manage_bookings` in the page itself, and the editing controls key off
// `useCaps()`. Totals live behind `view_revenue` and never render here.
export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requirePageCapability("checkin", slug);
  return <>{children}</>;
}

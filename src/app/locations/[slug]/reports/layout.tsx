import { requirePageCapability } from "@/lib/auth/roles";

// A report is an aggregate by definition, so the whole section sits behind `view_revenue` (director+)
// rather than `manage_bookings`. Individual reports may gate themselves further — uncollected fees is
// admin-only, being Turbo Bookings' own revenue rather than the operator's.
export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requirePageCapability("view_revenue", slug);
  return <>{children}</>;
}

import { requirePageCapability } from "@/lib/auth/roles";

// Everyone who works the venue sees the dashboard, because its top half answers an operational
// question — what is running today and how many vehicles go out. The sales half is gated on
// `view_revenue` inside the page, so a front-line user gets the counts and none of the money.
export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requirePageCapability("checkin", slug);
  return <>{children}</>;
}

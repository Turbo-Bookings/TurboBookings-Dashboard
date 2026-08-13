import { requirePageCapability } from "@/lib/auth/roles";

// Director+ only (revenue + booking management) behind the hidden nav.
export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requirePageCapability("manage_bookings", slug);
  return <>{children}</>;
}

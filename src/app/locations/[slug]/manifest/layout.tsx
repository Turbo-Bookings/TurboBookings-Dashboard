import { requirePageCapability } from "@/lib/auth/roles";

// The manifest had NO gate of its own — it sat under the location RoleGate, which only asks whether
// you hold any role here at all. In practice that is the same set of people `checkin` admits, but
// only by accident: the moment a role is added that should not see the day's bookings, an ungated
// subtree grants it silently. State the requirement instead of inheriting it.
export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requirePageCapability("checkin", slug);
  return <>{children}</>;
}

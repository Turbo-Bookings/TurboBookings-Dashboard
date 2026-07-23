import { requirePageCapability } from "@/lib/auth/roles";

// Director+ only (revenue + booking management) behind the hidden nav.
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requirePageCapability("manage_bookings");
  return <>{children}</>;
}

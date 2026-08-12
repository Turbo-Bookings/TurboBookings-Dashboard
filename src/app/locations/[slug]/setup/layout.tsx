import { requirePageCapability } from "@/lib/auth/roles";

// Go-live/setup tracking is Turbo-controlled — admin+ only (operators are
// hidden from it). Defense-in-depth behind the hidden nav.
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requirePageCapability("manage_platform");
  return <>{children}</>;
}

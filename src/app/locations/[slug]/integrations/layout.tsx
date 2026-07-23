import { requirePageCapability } from "@/lib/auth/roles";

// Config surface — admin+ only (defense-in-depth behind the hidden nav).
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requirePageCapability("manage_config");
  return <>{children}</>;
}

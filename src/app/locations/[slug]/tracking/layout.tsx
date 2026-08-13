import { requirePageCapability } from "@/lib/auth/roles";

// Marketing/tracking is Turbo-controlled — admin+ only (operators are hidden
// from it). Defense-in-depth behind the hidden nav.
export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requirePageCapability("manage_platform", slug);
  return <>{children}</>;
}

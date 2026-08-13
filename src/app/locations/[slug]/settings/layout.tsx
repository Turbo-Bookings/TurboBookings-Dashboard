import { requirePageCapability } from "@/lib/auth/roles";

// Config surface — admin+ only (defense-in-depth behind the hidden nav).
export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requirePageCapability("manage_config", slug);
  return <>{children}</>;
}

import { CatalogSubNav } from "@/components/CatalogSubNav";
import { requirePageCapability } from "@/lib/auth/roles";

type Props = {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
};

export default async function CatalogLayout({ children, params }: Props) {
  const { slug } = await params;
  await requirePageCapability("manage_config");

  return (
    <div>
      <CatalogSubNav slug={slug} />
      <div className="mt-6">{children}</div>
    </div>
  );
}

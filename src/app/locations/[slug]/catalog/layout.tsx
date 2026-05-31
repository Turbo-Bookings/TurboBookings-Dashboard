import { CatalogSubNav } from "@/components/CatalogSubNav";

type Props = {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
};

export default async function CatalogLayout({ children, params }: Props) {
  const { slug } = await params;

  return (
    <div>
      <CatalogSubNav slug={slug} />
      <div className="mt-6">{children}</div>
    </div>
  );
}

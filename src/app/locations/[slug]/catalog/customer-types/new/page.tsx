import Link from "next/link";
import { notFound } from "next/navigation";
import { CustomerTypeForm } from "@/components/CustomerTypeForm";
import { createCustomerType } from "@/lib/actions/customerTypes";
import { getLocationBySlug } from "@/lib/data/locations";

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function NewCustomerTypePage({ params }: Props) {
  const { slug } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();

  const action = createCustomerType.bind(null, slug);

  return (
    <section>
      <div className="mb-4 flex items-center gap-2 text-xs text-zinc-500">
        <Link
          href={`/locations/${slug}/catalog/customer-types`}
          className="hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          Customer types
        </Link>
        <span>/</span>
        <span>New</span>
      </div>
      <h2 className="mb-6 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        New customer type
      </h2>
      <CustomerTypeForm
        action={action}
        cancelHref={`/locations/${slug}/catalog/customer-types`}
        submitLabel="Create"
      />
    </section>
  );
}

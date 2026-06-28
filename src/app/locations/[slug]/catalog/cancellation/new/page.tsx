import { notFound } from "next/navigation";
import { CancellationPolicyForm } from "@/components/CancellationPolicyForm";
import { createPolicy } from "@/lib/actions/cancellationPolicies";
import { getLocationBySlug } from "@/lib/data/locations";

type Props = { params: Promise<{ slug: string }> };

export default async function NewPolicyPage({ params }: Props) {
  const { slug } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();
  const action = createPolicy.bind(null, slug);

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        New cancellation policy
      </h2>
      <CancellationPolicyForm
        action={action}
        cancelHref={`/locations/${slug}/catalog/cancellation`}
        submitLabel="Create policy"
      />
    </section>
  );
}

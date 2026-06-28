import { notFound } from "next/navigation";
import { CancellationPolicyForm } from "@/components/CancellationPolicyForm";
import { DeletePolicyButton } from "@/components/DeletePolicyButton";
import { updatePolicy } from "@/lib/actions/cancellationPolicies";
import { getPolicy } from "@/lib/data/cancellationPolicies";
import { getLocationBySlug } from "@/lib/data/locations";

type Props = { params: Promise<{ slug: string; id: string }> };

export default async function EditPolicyPage({ params }: Props) {
  const { slug, id } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();
  const policy = await getPolicy(id, loc.id);
  if (!policy) notFound();
  const action = updatePolicy.bind(null, slug, id);

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Edit {policy.name}
        </h2>
        <DeletePolicyButton slug={slug} id={id} />
      </div>
      <CancellationPolicyForm
        action={action}
        cancelHref={`/locations/${slug}/catalog/cancellation`}
        initial={{
          name: policy.name,
          gracePeriodMinutes: String(policy.gracePeriodMinutes),
          isDefault: policy.isDefault,
          rules: policy.rules.map((r) => ({
            hours: String(r.hoursBeforeStart),
            pct: String(r.refundPctBps / 100),
          })),
        }}
        submitLabel="Save changes"
      />
    </section>
  );
}

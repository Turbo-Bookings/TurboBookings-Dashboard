import { redirect } from "next/navigation";

// Reports moved to its own top-level section.
export default async function ReportsRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/locations/${slug}/reports`);
}

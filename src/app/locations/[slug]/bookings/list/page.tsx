import { redirect } from "next/navigation";

// Bookings list moved to the /bookings index.
export default async function BookingsListRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/locations/${slug}/bookings`);
}

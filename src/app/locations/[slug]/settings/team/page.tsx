import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { TeamManager } from "@/components/TeamManager";
import { assignableRoles, requirePageCapability } from "@/lib/auth/roles";
import {
  getPendingInvitesForLocation,
  getTeamForLocation,
} from "@/lib/actions/team";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export default async function TeamSettingsPage({ params }: Props) {
  const { slug } = await params;
  await requirePageCapability("manage_team", slug);

  const [members, invites, assignable, { userId }] = await Promise.all([
    getTeamForLocation(slug),
    getPendingInvitesForLocation(slug),
    assignableRoles(slug),
    auth(),
  ]);

  return (
    <section>
      <div className="mb-2">
        <Link
          href={`/locations/${slug}/settings`}
          className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Settings
        </Link>
      </div>
      <PageHeader
        title="Team"
        description="Invite people and set what they can access at this location. Invites are emailed and the role is applied automatically when they sign up."
      />
      <TeamManager
        slug={slug}
        members={members}
        invites={invites}
        assignable={assignable}
        currentUserId={userId ?? ""}
      />
    </section>
  );
}

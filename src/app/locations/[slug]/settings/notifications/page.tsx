import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { NotificationsForm } from "@/components/NotificationsForm";
import {
  EmailTemplatesEditor,
  type EmailTemplateInitial,
} from "@/components/EmailTemplatesEditor";
import {
  updateEmailTemplate,
  updateNotifications,
  type EditableEmailType,
} from "@/lib/actions/locations";
import { getLocationBySlug } from "@/lib/data/locations";
import { discountCodes, emailTemplates, getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

const EDITABLE_TYPES: EditableEmailType[] = [
  "reminder_24h",
  "reminder_2h",
  "abandoned_cart_1",
  "abandoned_cart_2",
  "post_tour_review",
  "cancellation",
  "reschedule",
];

export default async function NotificationsSettingsPage({ params }: Props) {
  const { slug } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();

  const db = getDb();
  const [rows, codes] = await Promise.all([
    db
      .select()
      .from(emailTemplates)
      .where(eq(emailTemplates.locationId, loc.id)),
    db
      .select({ id: discountCodes.id, code: discountCodes.code })
      .from(discountCodes)
      .where(
        and(
          eq(discountCodes.locationId, loc.id),
          eq(discountCodes.active, true),
        ),
      ),
  ]);
  const byType = new Map(rows.map((r) => [r.type, r]));

  const initial: EmailTemplateInitial[] = EDITABLE_TYPES.map((type) => {
    const r = byType.get(type);
    return {
      type,
      enabled: r?.enabled ?? true,
      subject: r?.subject ?? "",
      body: r?.bodyMd ?? "",
      discountCodeId: r?.discountCodeId ?? "",
    };
  });

  const confirmationAction = updateNotifications.bind(null, slug);

  return (
    <section data-tour="notifications">
      <div className="mb-2">
        <Link
          href={`/locations/${slug}/settings`}
          className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Settings
        </Link>
      </div>
      <PageHeader
        title="Notifications"
        description="Emails customers receive around their booking. Branding, From name, and reply-to are pulled from this location's settings automatically. You can edit the copy and turn each email on or off."
      />
      <NotificationsForm
        action={confirmationAction}
        initial={loc.confirmationEmailMessageMd ?? ""}
      />
      <div className="mt-8">
        <EmailTemplatesEditor
          slug={slug}
          initial={initial}
          discountCodes={codes}
          action={updateEmailTemplate}
        />
      </div>
    </section>
  );
}

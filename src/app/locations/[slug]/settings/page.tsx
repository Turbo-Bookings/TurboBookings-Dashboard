import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CalendarX,
  ClipboardCheck,
  History,
  LineChart,
  ListChecks,
  Mail,
  MailPlus,
  Boxes,
  Palette,
  Percent,
  Plug,
  Receipt,
  Star,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { SettingsPanel } from "@/components/SettingsPanel";
import { can } from "@/lib/auth/roles";
import { getLocationBySlug } from "@/lib/data/locations";
import { TONE_SOFT, type Tone } from "@/lib/ui/status";

// `platform: true` = Turbo-only surface (manage_platform); hidden from operators.
type Item = { label: string; desc: string; href: string; icon: LucideIcon; tone: Tone; platform?: boolean };
type Group = { title: string; desc: string; items: Item[] };

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();
  const b = `/locations/${slug}`;
  const showPlatform = await can("manage_platform", slug);

  const groups: Group[] = [
    {
      title: "Build",
      desc: "Shared catalog config reused across your tours.",
      items: [
        { label: "Customer Types", desc: "Rider types & pricing tiers", href: `${b}/catalog/customer-types`, icon: Users, tone: "blue" },
        { label: "Resources", desc: "Capacity pools (ATVs, UTVs, guides)", href: `${b}/catalog/resources`, icon: Boxes, tone: "violet" },
        { label: "Custom Fields", desc: "Questions, acknowledgments, add-ons", href: `${b}/catalog/custom-fields`, icon: ListChecks, tone: "amber" },
        { label: "Discount Codes", desc: "Promo codes for checkout", href: `${b}/catalog/discounts`, icon: Percent, tone: "emerald" },
        { label: "Cancellation Policies", desc: "Refund rules & grace periods", href: `${b}/catalog/cancellation`, icon: CalendarX, tone: "red" },
      ],
    },
    {
      title: "Payments & pricing",
      desc: "What you charge and collect.",
      items: [
        { label: "Taxes & Fees", desc: "Tax rate, processing fee, deposit", href: `${b}/settings/taxes-fees`, icon: Receipt, tone: "emerald" },
      ],
    },
    {
      title: "Online Booking",
      desc: "How customers find and pay you online.",
      items: [
        { label: "Tracking", desc: "Pixels, GA4, CAPI & server-side events", href: `${b}/tracking`, icon: LineChart, tone: "blue", platform: true },
        { label: "Integrations", desc: "Stripe Connect & secrets", href: `${b}/integrations`, icon: Plug, tone: "violet" },
        { label: "Reviews", desc: "Google rating shown on the booking flow", href: `${b}/settings/reviews`, icon: Star, tone: "amber" },
        { label: "Notifications", desc: "Booking-confirmation email message", href: `${b}/settings/notifications`, icon: Mail, tone: "emerald" },
      ],
    },
    {
      title: "Website / Customer Front-End",
      desc: "Your branded booking experience.",
      items: [
        { label: "Branding & Tours", desc: "Logo, colors, fonts, media, tour content", href: b, icon: Palette, tone: "orange" },
        { label: "Email Popup", desc: "Signup popup to grow your list + lift ad match", href: `${b}/settings/popup`, icon: MailPlus, tone: "violet" },
      ],
    },
    {
      title: "Operations",
      desc: "People, launch readiness, and change history.",
      items: [
        { label: "Team", desc: "Invite people & set their access", href: `${b}/settings/team`, icon: UserPlus, tone: "blue" },
        { label: "Setup", desc: "External-dependency checklist", href: `${b}/setup`, icon: ClipboardCheck, tone: "amber", platform: true },
        { label: "Activity", desc: "Audit log of every change", href: `${b}/activity`, icon: History, tone: "zinc" },
      ],
    },
  ];

  return (
    <section>
      <PageHeader title="Settings" description="Everything that configures this location." />

      <div className="space-y-8">
        {groups
          .map((g) => ({
            ...g,
            items: g.items.filter((it) => showPlatform || !it.platform),
          }))
          .filter((g) => g.items.length > 0)
          .map((g) => (
          <div key={g.title}>
            <div className="mb-2">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{g.title}</h2>
              <p className="text-xs text-zinc-500">{g.desc}</p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {g.items.map((it) => {
                const Icon = it.icon;
                return (
                  <Link
                    key={it.label}
                    href={it.href}
                    className="group flex items-start gap-3 rounded-xl border border-zinc-200 bg-white p-4 transition-colors hover:border-blue-300 hover:bg-blue-50/40 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-blue-800 dark:hover:bg-blue-950/20"
                  >
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${TONE_SOFT[it.tone]}`}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-900 group-hover:text-blue-700 dark:text-zinc-100 dark:group-hover:text-blue-300">
                        {it.label}
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-500">{it.desc}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}

        {/* Account */}
        <div>
          <div className="mb-2">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Account</h2>
            <p className="text-xs text-zinc-500">Location lifecycle, external resources, and danger zone.</p>
          </div>
          <SettingsPanel location={loc} />
        </div>
      </div>
    </section>
  );
}

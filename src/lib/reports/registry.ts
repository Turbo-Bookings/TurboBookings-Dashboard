import {
  BarChart3,
  CalendarSync,
  ClipboardCheck,
  Landmark,
  Percent,
  PhoneOff,
  Receipt,
  UserRoundCheck,
  type LucideIcon,
} from "lucide-react";
import type { Capability } from "@/lib/auth/capabilities";

/**
 * Every report, in one list.
 *
 * Adding a report used to mean editing three places by hand — the nav in `LocationShell`, the quick
 * links on the dashboard, and a hand-written `<Link>` inside the reports index — with nothing
 * connecting them. Half-finishing that is invisible: the report exists, works, and is unreachable.
 *
 * One entry plus one folder now. The index renders from this, visibility is filtered from `cap`, and
 * a report that is not listed here does not exist as far as the product is concerned.
 *
 * No `server-only`: the icons and this list are read by client-side nav too.
 */

export type ReportDef = {
  /** URL segment under `/locations/<slug>/reports/`. Empty string = the index itself. */
  key: string;
  title: string;
  /** One line on the index card. Say what question it answers, not what it contains. */
  blurb: string;
  icon: LucideIcon;
  cap: Capability;
  /**
   * Which clock the report runs on. Shown in the page header, always — the dashboard's own comment
   * makes the case: a figure without its time basis is the fastest way to a confident wrong answer,
   * because "sales this week" means three different numbers depending on whether you count when a
   * booking was made, when the tour runs, or when the money arrived.
   */
  basis: "tour_date" | "booking_date" | "payment_date" | "action_date";
  /** Whether the page offers a CSV download. */
  csv: boolean;
};

const BASIS_LABEL: Record<ReportDef["basis"], string> = {
  tour_date: "By tour date",
  booking_date: "By date booked",
  payment_date: "By payment date",
  action_date: "By date actioned",
};

export function basisLabel(basis: ReportDef["basis"]): string {
  return BASIS_LABEL[basis];
}

export const REPORTS: ReportDef[] = [
  {
    key: "revenue",
    title: "Revenue",
    blurb: "What was sold, collected, and left to collect — broken down by tour.",
    icon: BarChart3,
    cap: "view_revenue",
    basis: "tour_date",
    csv: true,
  },
  {
    key: "checkin",
    title: "Check-in",
    blurb: "Who rode, who no-showed, and who was never marked either way.",
    icon: ClipboardCheck,
    // No money on this one, and the desk is who needs it — the only report front-line staff see.
    cap: "checkin",
    basis: "tour_date",
    csv: true,
  },
  {
    key: "no-shows",
    title: "No-shows",
    blurb: "Who did not turn up, their number, and where the call-back stands.",
    icon: PhoneOff,
    // Not money, but it carries customer contact details and drives outreach — a sales act, so the
    // same bar as managing a booking rather than the desk's.
    cap: "manage_bookings",
    basis: "tour_date",
    csv: true,
  },
  {
    key: "reschedules",
    title: "Reschedules & win-backs",
    blurb: "Every move, with the no-shows we got back into a slot first.",
    icon: CalendarSync,
    cap: "manage_bookings",
    // Ranged on when the MOVE happened — "what did the team win back last week" is a question about
    // the team's week, not about either tour date.
    basis: "action_date",
    csv: true,
  },
  {
    key: "cash",
    title: "Cash to collect",
    blurb: "What the venue should be holding, split by card taken at the desk and cash.",
    icon: Landmark,
    cap: "view_revenue",
    basis: "tour_date",
    csv: true,
  },
  {
    key: "sales-by-user",
    title: "Sales by user",
    blurb: "Bookings each person took, and what they were worth.",
    icon: UserRoundCheck,
    cap: "view_revenue",
    basis: "booking_date",
    csv: true,
  },
  {
    key: "tax",
    title: "Sales tax",
    blurb: "Tax collected online, for filing.",
    icon: Percent,
    cap: "view_revenue",
    basis: "tour_date",
    csv: true,
  },
  {
    key: "uncollected-fees",
    title: "Uncollected platform fees",
    blurb: "Turbo Bookings' 6% that could not be taken, and how to recover it.",
    icon: Receipt,
    // Our revenue, not the operator's — admin+ only, and deliberately not in anyone else's way.
    cap: "manage_platform",
    basis: "tour_date",
    csv: false,
  },
];

/** The reports a given set of capabilities can reach. */
export function visibleReports(caps: Record<Capability, boolean>): ReportDef[] {
  return REPORTS.filter((r) => caps[r.cap]);
}

export function reportByKey(key: string): ReportDef | undefined {
  return REPORTS.find((r) => r.key === key);
}

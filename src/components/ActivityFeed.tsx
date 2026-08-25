import { DateTime } from "luxon";
import type { AuditLog } from "@/lib/db/schema";
import { labelFor, resolveUserLabels } from "@/lib/users";

type Props = {
  entries: AuditLog[];
  /** The LOCATION's timezone. See formatTime below for why this is not optional in practice. */
  tz: string;
};

// Maps Clerk action prefix → small badge color. Visual cue for which
// surface produced the audit row.
const ACTION_STYLES: Record<string, string> = {
  branding: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-200",
  tracking: "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-200",
  secret: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-200",
  tour_catalog: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200",
  setup: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
};

function actionStyle(action: string): string {
  const prefix = action.split(".")[0];
  return ACTION_STYLES[prefix] ?? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200";
}

// Rendered in the LOCATION's timezone, not the server's.
//
// This used to call `toLocaleString` with no zone at all, which means the Node process's zone — UTC
// on Vercel. So every timestamp on this page was an hour or five off, consistently, in a way that
// looks like a plausible time rather than a wrong one. A wrong clock on an audit log is worse than
// no clock: it is the column you reach for when reconstructing what happened and when.
function formatTime(ts: Date, tz: string): string {
  return DateTime.fromJSDate(ts).setZone(tz).toFormat("LLL d, h:mm a");
}

// Server component — resolves Clerk user labels at render time. One round
// trip per unique userId in the feed, cached for the request.
export async function ActivityFeed({ entries, tz }: Props) {
  if (entries.length === 0) {
    return (
      <div className="rounded-md border-2 border-dashed border-zinc-200 bg-zinc-50/50 p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/30">
        No activity yet for this location. Every config change here will show
        up in this feed going forward.
      </div>
    );
  }

  // Was inlined here, and so existed only here — every other surface that wanted to show who did
  // something simply showed nothing. Now shared with the booking history and the reports.
  const actors = await resolveUserLabels(entries.map((e) => e.userId));

  return (
    <ol className="space-y-2">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
            <span className="font-mono text-zinc-400">
              {formatTime(entry.createdAt, tz)}
            </span>
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              {labelFor(actors, entry.userId).name}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-medium ${actionStyle(entry.action)}`}
            >
              {entry.action}
            </span>
          </div>
          <div className="mt-1 text-sm text-zinc-900 dark:text-zinc-100">
            {entry.summary}
          </div>
        </li>
      ))}
    </ol>
  );
}

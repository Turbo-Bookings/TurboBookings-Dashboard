import { clerkClient } from "@clerk/nextjs/server";
import type { AuditLog } from "@/lib/db/schema";

type Props = {
  entries: AuditLog[];
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

function formatTime(ts: Date): string {
  // Compact relative-ish format: "May 22, 12:34 AM"
  return ts.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Server component — resolves Clerk user labels at render time. One round
// trip per unique userId in the feed, cached for the request.
export async function ActivityFeed({ entries }: Props) {
  if (entries.length === 0) {
    return (
      <div className="rounded-md border-2 border-dashed border-zinc-200 bg-zinc-50/50 p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/30">
        No activity yet for this location. Every config change here will show
        up in this feed going forward.
      </div>
    );
  }

  // Resolve Clerk user labels in parallel.
  const uniqueUserIds = Array.from(
    new Set(
      entries
        .map((e) => e.userId)
        .filter((id): id is string => typeof id === "string"),
    ),
  );

  const userLabels = new Map<string, string>();
  if (uniqueUserIds.length > 0) {
    const clerk = await clerkClient();
    await Promise.all(
      uniqueUserIds.map(async (id) => {
        try {
          const u = await clerk.users.getUser(id);
          const label =
            u.primaryEmailAddress?.emailAddress ??
            u.username ??
            u.firstName ??
            id.slice(0, 8);
          userLabels.set(id, label);
        } catch {
          userLabels.set(id, id.slice(0, 8));
        }
      }),
    );
  }

  return (
    <ol className="space-y-2">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
            <span className="font-mono text-zinc-400">
              {formatTime(entry.createdAt)}
            </span>
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              {entry.userId
                ? (userLabels.get(entry.userId) ?? entry.userId.slice(0, 8))
                : "System"}
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

import type { LucideIcon } from "lucide-react";
import { TONE_SOFT, type Tone } from "@/lib/ui/status";

export function StatTile({
  label,
  value,
  sub,
  tone = "blue",
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
  icon?: LucideIcon;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          {label}
        </span>
        {Icon && (
          <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${TONE_SOFT[tone]}`}>
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

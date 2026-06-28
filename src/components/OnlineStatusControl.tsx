"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Globe, Lock, Wand2 } from "lucide-react";
import { setSlotStatus } from "@/lib/actions/availability";

const OPTS = [
  { v: "on", label: "Bookable online" },
  { v: "off", label: "Online closed" },
  { v: "auto", label: "Auto" },
];

export function OnlineStatusControl({
  slug,
  slotId,
  status,
}: {
  slug: string;
  slotId: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const Icon = status === "off" ? Lock : status === "auto" ? Wand2 : Globe;
  const color =
    status === "off"
      ? "text-zinc-500"
      : status === "auto"
        ? "text-violet-600 dark:text-violet-400"
        : "text-emerald-600 dark:text-emerald-400";

  return (
    <span className="inline-flex items-center gap-1">
      <Icon className={`h-3.5 w-3.5 ${color}`} />
      <select
        value={status}
        disabled={pending}
        onChange={(e) => {
          setError(null);
          const next = e.target.value;
          startTransition(async () => {
            const r = await setSlotStatus(slug, slotId, next);
            if (!r.ok) setError(r.error ?? "Failed");
            else router.refresh();
          });
        }}
        className="rounded-md border border-zinc-200 bg-transparent py-0.5 pl-1 pr-6 text-xs font-medium text-zinc-600 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
      >
        {OPTS.map((o) => (
          <option key={o.v} value={o.v}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

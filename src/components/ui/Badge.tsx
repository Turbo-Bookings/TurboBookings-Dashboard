import type { ReactNode } from "react";
import { TONE_PILL, type Tone } from "@/lib/ui/status";

export function Badge({ tone = "zinc", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE_PILL[tone]}`}
    >
      {children}
    </span>
  );
}

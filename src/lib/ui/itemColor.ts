import type { Tone } from "@/lib/ui/status";

// Deterministic color per tour so the manifest/grid color-code consistently
// without a DB color column. Hash the item id → a palette tone.
const PALETTE: Tone[] = ["blue", "emerald", "violet", "amber", "orange", "red"];

export function itemColor(itemId: string): Tone {
  let h = 0;
  for (let i = 0; i < itemId.length; i++) h = (h * 31 + itemId.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

// Hex dot colors (for the small color dot) keyed by tone — light + readable.
export const TONE_DOT: Record<Tone, string> = {
  blue: "bg-blue-500",
  emerald: "bg-emerald-500",
  violet: "bg-violet-500",
  amber: "bg-amber-500",
  orange: "bg-orange-500",
  red: "bg-red-500",
  zinc: "bg-zinc-400",
};

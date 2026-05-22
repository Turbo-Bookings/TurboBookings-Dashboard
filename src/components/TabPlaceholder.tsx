type Props = {
  name: string;
  description: string;
  phase: "Phase 1" | "Phase 1.5" | "Phase 2";
};

// Used by every per-location tab until its real content lands. Renders a
// dashed-border card with the tab name + a short description of what'll
// eventually live there, plus the phase that ships it. Removes guesswork
// about whether a tab is "missing" vs "not yet built."
export function TabPlaceholder({ name, description, phase }: Props) {
  return (
    <div className="mt-6 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-200 bg-zinc-50/50 p-12 text-center dark:border-zinc-800 dark:bg-zinc-900/30">
      <span className="font-mono text-xs uppercase tracking-widest text-zinc-400">
        {phase}
      </span>
      <h2 className="mt-2 text-lg font-semibold text-zinc-700 dark:text-zinc-200">
        {name}
      </h2>
      <p className="mt-2 max-w-md text-sm text-zinc-500">{description}</p>
    </div>
  );
}

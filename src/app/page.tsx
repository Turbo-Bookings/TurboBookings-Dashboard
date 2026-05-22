export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 p-8 dark:bg-zinc-950">
      <div className="flex max-w-xl flex-col items-center gap-4 text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-zinc-500">
          TurboBookings
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Dashboard
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Multi-tenant client portal for ATV-tour location buildouts and ops.
          Phase 1 in progress.
        </p>
      </div>
    </main>
  );
}

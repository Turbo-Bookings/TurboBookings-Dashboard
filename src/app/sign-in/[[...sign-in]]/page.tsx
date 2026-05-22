import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 p-8 dark:bg-zinc-950">
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <div className="text-center">
          <p className="font-mono text-xs uppercase tracking-widest text-zinc-500">
            TurboBookings
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Dashboard
          </h1>
        </div>
        <SignIn />
      </div>
    </main>
  );
}

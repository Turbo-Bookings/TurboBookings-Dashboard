import { ShieldQuestion } from "lucide-react";
import { UserButton } from "@clerk/nextjs";
import { hasAssignedRole } from "@/lib/auth/roles";

// Gates every authed surface behind an assigned role. A signed-in user with no
// role (fresh sign-up / invited but not yet granted access) sees a friendly
// "pending" screen instead of the dashboard — the app fails CLOSED rather than
// treating an unassigned user as an admin. Mount at the authed entry points.
export async function RoleGate({ children }: { children: React.ReactNode }) {
  if (await hasAssignedRole()) return <>{children}</>;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-6 text-center dark:bg-zinc-950">
      <div className="absolute right-4 top-4">
        <UserButton appearance={{ elements: { avatarBox: "h-8 w-8" } }} />
      </div>
      <div className="max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
          <ShieldQuestion className="h-6 w-6" />
        </div>
        <h1 className="mt-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Your account is being set up
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          You&apos;re signed in, but your access hasn&apos;t been granted yet.
          Ask your administrator to assign your role, then refresh this page.
        </p>
      </div>
    </div>
  );
}

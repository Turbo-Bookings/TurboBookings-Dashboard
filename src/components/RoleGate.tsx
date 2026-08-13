import { ShieldQuestion } from "lucide-react";
import { UserButton } from "@clerk/nextjs";
import { hasAssignedRoleAnywhere, hasRoleForLocation } from "@/lib/auth/roles";

// Gates authed surfaces behind an assigned role (fail CLOSED). With a `slug`,
// it checks access to THAT location; without one, whether the user has a role
// anywhere (home / new-location). A signed-in user without the needed role sees
// a friendly screen instead of the app.
export async function RoleGate({
  slug,
  children,
}: {
  slug?: string;
  children: React.ReactNode;
}) {
  const ok = slug
    ? await hasRoleForLocation(slug)
    : await hasAssignedRoleAnywhere();
  if (ok) return <>{children}</>;

  const title = slug
    ? "You don't have access to this location"
    : "Your account is being set up";
  const body = slug
    ? "Your account doesn't have a role at this location. Ask an administrator to grant you access, then refresh."
    : "You're signed in, but your access hasn't been granted yet. Ask your administrator to assign your role, then refresh this page.";

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
          {title}
        </h1>
        <p className="mt-2 text-sm text-zinc-500">{body}</p>
      </div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { Loader2, Mail, Trash2, X } from "lucide-react";
import type { Role } from "@/lib/auth/roles";
import {
  assignRole,
  removeMember,
  revokeInvitation,
  type PendingInvite,
  type TeamMember,
} from "@/lib/actions/team";

const ROLE_LABEL: Record<Role, string> = {
  master: "Owner (all locations)",
  admin: "Admin (all locations)",
  operator: "Operator",
  director: "Manager",
  basic_user: "Staff (check-in)",
};
const ROLE_ORDER: Role[] = ["master", "admin", "operator", "director", "basic_user"];

const input =
  "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

export function TeamManager({
  slug,
  members,
  invites,
  assignable,
  currentUserId,
}: {
  slug: string;
  members: TeamMember[];
  invites: PendingInvite[];
  assignable: Role[];
  currentUserId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>(assignable[assignable.length - 1] ?? "director");
  const roleOptions = ROLE_ORDER.filter((r) => assignable.includes(r));

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
    });
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Invite */}
      <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold">Invite someone</h2>
        <p className="mt-1 text-xs text-zinc-500">
          They&apos;ll get an email to set up their account with this role already applied.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="email"
            placeholder="name@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`${input} min-w-[16rem] flex-1`}
          />
          <select value={role} onChange={(e) => setRole(e.target.value as Role)} className={input}>
            {roleOptions.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={pending || !email.trim()}
            onClick={() => run(() => assignRole(slug, email, role).then((r) => (r.ok && setEmail(""), r)))}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            Invite
          </button>
        </div>
        {error && <p className="mt-2 text-sm font-medium text-red-600">{error}</p>}
      </section>

      {/* Members */}
      <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold">Members</h2>
        <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
          {members.map((m) => {
            const isSelf = m.userId === currentUserId;
            const editable = !isSelf && assignable.includes(m.role);
            return (
              <li key={m.userId} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {m.name || m.email}
                    {isSelf && <span className="ml-1 text-xs text-zinc-400">(you)</span>}
                  </p>
                  {m.name && <p className="truncate text-xs text-zinc-500">{m.email}</p>}
                </div>
                {editable ? (
                  <select
                    value={m.role}
                    disabled={pending}
                    onChange={(e) => run(() => assignRole(slug, m.email, e.target.value as Role))}
                    className={`${input} py-1.5`}
                  >
                    {roleOptions.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="rounded bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {ROLE_LABEL[m.role]}
                  </span>
                )}
                {editable && (
                  <button
                    type="button"
                    disabled={pending}
                    title="Remove"
                    onClick={() => run(() => removeMember(slug, m.userId))}
                    className="rounded-md p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950/40"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            );
          })}
          {members.length === 0 && (
            <li className="py-2 text-sm text-zinc-500">No members yet.</li>
          )}
        </ul>
      </section>

      {/* Pending invites */}
      {invites.length > 0 && (
        <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-semibold">Pending invites</h2>
          <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
            {invites.map((inv) => (
              <li key={inv.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{inv.email}</p>
                </div>
                <span className="rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400">
                  {ROLE_LABEL[inv.role]}
                </span>
                <button
                  type="button"
                  disabled={pending}
                  title="Revoke"
                  onClick={() => run(() => revokeInvitation(slug, inv.id))}
                  className="rounded-md p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950/40"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

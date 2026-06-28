"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import {
  type SaveSecretState,
  type SecretSummary,
  clearSecret,
  setSecret,
} from "@/lib/actions/integrations";
import { SECRET_KINDS, type SecretKind } from "@/lib/integrations/catalog";

const INITIAL_STATE = { ok: false as const, error: "" };

type Props = {
  slug: string;
  kind: SecretKind;
  summary: SecretSummary;
  vercelProjectLinked: boolean;
};

export function SecretCard({ slug, kind, summary, vercelProjectLinked }: Props) {
  const meta = SECRET_KINDS[kind];
  const [showField, setShowField] = useState(!summary.configured);

  const boundSave = setSecret.bind(null, slug, kind);
  const [state, formAction] = useActionState<SaveSecretState, FormData>(
    boundSave,
    INITIAL_STATE,
  );
  const [clearing, startClear] = useTransition();

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {meta.label}
            </h3>
            <code className="font-mono text-[10px] text-zinc-400">{kind}</code>
          </div>
          <p className="mt-1 text-xs text-zinc-500">{meta.description}</p>
        </div>

        <StatusBadges summary={summary} vercelProjectLinked={vercelProjectLinked} />
      </div>

      {state.ok && (
        <p className="mt-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          ✓ Saved
          {state.pushedToVercel
            ? " · pushed to Vercel"
            : state.pushReason
              ? ` · ${state.pushReason}`
              : ""}
        </p>
      )}
      {!state.ok && state.error && (
        <p className="mt-2 text-xs font-medium text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}

      {showField ? (
        <form action={formAction} className="mt-3 space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="password"
              name="value"
              autoComplete="off"
              placeholder={meta.placeholder}
              className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-950"
              required
            />
            <SaveButton />
            {summary.configured && (
              <button
                type="button"
                onClick={() => setShowField(false)}
                className="rounded-md px-3 py-2 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowField(true)}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Replace
          </button>
          <button
            type="button"
            disabled={clearing}
            onClick={() => {
              if (!confirm("Clear this secret? This also removes it from Vercel env if configured.")) return;
              startClear(() => {
                void clearSecret(slug, kind);
              });
            }}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950"
          >
            {clearing ? "Clearing…" : "Clear"}
          </button>
        </div>
      )}
    </div>
  );
}

function StatusBadges({
  summary,
  vercelProjectLinked,
}: {
  summary: SecretSummary;
  vercelProjectLinked: boolean;
}) {
  if (!summary.configured) {
    return (
      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
        Not configured
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">
        🔒 Configured
      </span>
      {summary.vercelEnvSyncedAt ? (
        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-200">
          ↑ Pushed to Vercel
        </span>
      ) : vercelProjectLinked ? (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-200">
          Not pushed to Vercel
        </span>
      ) : (
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          No Vercel project linked
        </span>
      )}
    </div>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center rounded-md bg-zinc-900 px-3 py-2 text-xs font-medium text-white shadow-sm transition-colors hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
    >
      {pending ? "Saving…" : "Save"}
    </button>
  );
}

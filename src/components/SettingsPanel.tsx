"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Field } from "@/components/Field";
import { StatusBadge } from "@/components/StatusBadge";
import {
  deleteLocation,
  setLocationStatus,
  updateExternalLinks,
  type UpdateLinksState,
} from "@/lib/actions/lifecycle";
import type { Location } from "@/lib/db/schema";

type Props = {
  location: Location;
};

const STATUS_OPTIONS: Array<{ value: Location["status"]; label: string; hint: string }> = [
  { value: "draft", label: "Draft", hint: "Filling in intake fields — not yet building." },
  { value: "building", label: "Building", hint: "Fork CLI running or site under active dev." },
  { value: "launched", label: "Launched", hint: "Production site live." },
  { value: "paused", label: "Paused", hint: "Subscription paused or site disabled." },
  { value: "archived", label: "Archived", hint: "Out of rotation; kept for reference." },
];

const INITIAL_LINKS = { ok: false as const, error: "" };

export function SettingsPanel({ location }: Props) {
  const [statusPending, startStatusTransition] = useTransition();
  const [deletePending, startDeleteTransition] = useTransition();
  const [confirmText, setConfirmText] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [blockedStatus, setBlockedStatus] = useState<Location["status"] | null>(null);
  const [overrideReason, setOverrideReason] = useState("");

  const boundLinks = updateExternalLinks.bind(null, location.slug);
  const [linksState, linksAction] = useActionState<UpdateLinksState, FormData>(
    boundLinks,
    INITIAL_LINKS,
  );

  function changeStatus(newStatus: Location["status"], override?: string) {
    if (newStatus === location.status) return;
    setStatusError(null);
    startStatusTransition(async () => {
      const res = await setLocationStatus(location.slug, newStatus, override);
      if (!res.ok) {
        // Previously the result was discarded, so a rejected transition looked
        // like nothing happened at all.
        setStatusError(res.error);
        setBlockedStatus(newStatus);
      } else {
        setBlockedStatus(null);
        setOverrideReason("");
      }
    });
  }

  function doDelete() {
    setDeleteError(null);
    startDeleteTransition(async () => {
      const result = await deleteLocation(location.slug, confirmText);
      if (!result.ok) setDeleteError(result.error ?? "Delete failed");
      // On success the action redirects to /, so this block won't render.
    });
  }

  return (
    <div className="space-y-10">
      {/* Status / lifecycle */}
      <section className="space-y-3">
        <header>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Lifecycle status
          </h3>
          <p className="mt-1 text-xs text-zinc-500">
            Move the location through its lifecycle. Status drives master-list
            ordering and (eventually) gates which tabs are editable.
          </p>
        </header>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={location.status} />
          <span className="text-xs text-zinc-400">→</span>
          <select
            value={location.status}
            onChange={(e) =>
              changeStatus(e.target.value as Location["status"])
            }
            disabled={statusPending}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-zinc-500">
            {STATUS_OPTIONS.find((o) => o.value === location.status)?.hint}
          </p>

          {/* Launch gate: tracking must be verified on the LIVE site before a
              location can be marked launched. Overridable, but the reason is
              recorded to the audit log. */}
          {statusError && (
            <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40">
              <p className="text-xs font-semibold text-amber-900 dark:text-amber-100">
                Can&apos;t set status to “{blockedStatus}” yet
              </p>
              <pre className="mt-1 whitespace-pre-wrap font-sans text-xs text-amber-800 dark:text-amber-300">
                {statusError}
              </pre>
              {blockedStatus === "launched" && (
                <div className="mt-3 space-y-2">
                  <label className="block text-[11px] font-medium text-amber-900 dark:text-amber-100">
                    Launch anyway — reason (recorded in the audit log)
                  </label>
                  <input
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder="e.g. tracking verified manually in Events Manager"
                    className="w-full rounded border border-amber-300 bg-white px-2 py-1 text-xs dark:border-amber-800 dark:bg-zinc-900"
                  />
                  <button
                    type="button"
                    disabled={statusPending || !overrideReason.trim()}
                    onClick={() => changeStatus("launched", overrideReason)}
                    className="rounded border border-amber-400 px-2 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-amber-100 dark:hover:bg-amber-900/40"
                  >
                    Launch anyway
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* External resource links */}
      <section className="space-y-3">
        <header>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            External resources
          </h3>
          <p className="mt-1 text-xs text-zinc-500">
            Links to the location&apos;s Vercel project, GitHub repo, and Edge
            Config. Fork CLI fills these in automatically for new locations.
            For Miami / HTown you can paste them manually.
          </p>
        </header>
        <form action={linksAction} className="space-y-3">
          <Field
            label="Vercel project ID"
            name="vercelProjectId"
            defaultValue={location.vercelProjectId ?? ""}
            hint="Found in Vercel → Project → Settings → Project ID. Required for the Integrations tab to push secrets."
            placeholder="prj_…"
            optional
          />
          <Field
            label="Vercel Edge Config ID"
            name="vercelEdgeConfigId"
            defaultValue={location.vercelEdgeConfigId ?? ""}
            hint="Used by the future Tracking → Edge Config bridge."
            placeholder="ecfg_…"
            optional
          />
          <Field
            label="GitHub repo URL"
            name="githubRepoUrl"
            defaultValue={location.githubRepoUrl ?? ""}
            placeholder="https://github.com/Turbo-Bookings/…"
            optional
          />

          {!linksState.ok && linksState.error && (
            <p className="text-xs font-medium text-red-600 dark:text-red-400">
              {linksState.error}
            </p>
          )}
          <div className="flex items-center justify-end gap-3">
            {linksState.ok && (
              <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                ✓ Saved
              </span>
            )}
            <SaveLinksButton />
          </div>
        </form>

        {/* Quick deep-links to live resources */}
        <div className="mt-3 flex flex-wrap gap-2">
          {location.githubRepoUrl && (
            <ExternalLinkChip href={location.githubRepoUrl} label="↗ GitHub repo" />
          )}
          {location.vercelProjectId && (
            <ExternalLinkChip
              href={`https://vercel.com/dashboard?from-team-page=true`}
              label="↗ Vercel dashboard"
            />
          )}
          {location.domainCanonical && (
            <ExternalLinkChip href={location.domainCanonical} label="↗ Live site" />
          )}
        </div>
      </section>

      {/* Danger zone */}
      <section className="space-y-3">
        <header>
          <h3 className="text-sm font-semibold text-red-700 dark:text-red-400">
            Danger zone
          </h3>
          <p className="mt-1 text-xs text-zinc-500">
            Deleting a location wipes all its tabs (branding, tracking,
            secrets, setup items, activity log, asset library). The Vercel
            project, GitHub repo, and Neon DB on the location&apos;s own side
            are <em>not</em> touched — delete those manually if you want a
            full teardown.
          </p>
        </header>
        <div className="rounded-md border border-red-200 bg-red-50/50 p-4 dark:border-red-900 dark:bg-red-950/30">
          <label className="block text-xs font-medium text-red-900 dark:text-red-200">
            Type the slug{" "}
            <code className="font-mono">{location.slug}</code> to confirm:
          </label>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={location.slug}
            className="mt-2 block w-full max-w-xs rounded-md border border-red-300 bg-white px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-red-800 dark:bg-zinc-950"
          />
          {deleteError && (
            <p className="mt-2 text-xs font-medium text-red-600 dark:text-red-400">
              {deleteError}
            </p>
          )}
          <button
            type="button"
            onClick={doDelete}
            disabled={deletePending || confirmText !== location.slug}
            className="mt-3 inline-flex items-center justify-center rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-red-700 dark:hover:bg-red-800"
          >
            {deletePending ? "Deleting…" : "Delete location permanently"}
          </button>
        </div>
      </section>
    </div>
  );
}

function SaveLinksButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
    >
      {pending ? "Saving…" : "Save links"}
    </button>
  );
}

function ExternalLinkChip({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
    >
      {label}
    </a>
  );
}

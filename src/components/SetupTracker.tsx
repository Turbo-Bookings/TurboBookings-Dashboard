"use client";

import { useTransition } from "react";
import {
  initializeSetupItems,
  updateSetupItem,
} from "@/lib/actions/setup";
import { PHASE_LABELS } from "@/lib/external-setup/template";
import type { ExternalSetupItem, Location } from "@/lib/db/schema";

type Props = {
  location: Location;
  items: ExternalSetupItem[];
};

type Phase = ExternalSetupItem["phase"];

const PHASE_ORDER: Phase[] = [
  "domain_dns",
  "tracking_platforms",
  "email_sms",
  "fareharbor",
  "site_infrastructure",
  "indexing",
  "cutover",
];

const STATUS_STYLES: Record<ExternalSetupItem["status"], string> = {
  not_started: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  in_progress: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-200",
  submitted: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-200",
  approved: "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-200",
  verified: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200",
  failed: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200",
};

const STATUS_LABELS: Record<ExternalSetupItem["status"], string> = {
  not_started: "Not started",
  in_progress: "In progress",
  submitted: "Submitted",
  approved: "Approved",
  verified: "Verified",
  failed: "Failed",
};

export function SetupTracker({ location, items }: Props) {
  const [initializing, startInit] = useTransition();

  if (items.length === 0) {
    return (
      <div className="rounded-md border-2 border-dashed border-zinc-200 bg-zinc-50/50 p-8 text-center dark:border-zinc-800 dark:bg-zinc-900/30">
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          No setup checklist yet for this location
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          Seed the default template — DNS, Meta verification, Twilio A2P,
          Resend, FareHarbor, site infrastructure, indexing, cutover.
        </p>
        <button
          type="button"
          disabled={initializing}
          onClick={() =>
            startInit(() => {
              void initializeSetupItems(location.slug);
            })
          }
          className="mt-4 inline-flex items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {initializing ? "Initializing…" : "Initialize checklist"}
        </button>
      </div>
    );
  }

  const byPhase = new Map<Phase, ExternalSetupItem[]>();
  for (const phase of PHASE_ORDER) byPhase.set(phase, []);
  for (const item of items) byPhase.get(item.phase)?.push(item);

  return (
    <div className="space-y-8">
      {PHASE_ORDER.map((phase) => {
        const rows = byPhase.get(phase) ?? [];
        if (rows.length === 0) return null;
        return (
          <PhaseSection
            key={phase}
            phase={phase}
            items={rows}
            slug={location.slug}
          />
        );
      })}
    </div>
  );
}

function PhaseSection({
  phase,
  items,
  slug,
}: {
  phase: Phase;
  items: ExternalSetupItem[];
  slug: string;
}) {
  const total = items.length;
  const done = items.filter((i) => i.status === "verified").length;

  return (
    <section>
      <header className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          {PHASE_LABELS[phase]}
        </h3>
        <span className="font-mono text-xs text-zinc-400">
          {done}/{total}
        </span>
      </header>
      <div className="space-y-2">
        {items.map((item) => (
          <SetupRow key={item.id} item={item} slug={slug} />
        ))}
      </div>
    </section>
  );
}

function SetupRow({ item, slug }: { item: ExternalSetupItem; slug: string }) {
  const [pending, startTransition] = useTransition();
  const overdue =
    item.expectedBy &&
    new Date(item.expectedBy) < new Date() &&
    item.status !== "verified" &&
    item.status !== "approved";

  function update(patch: Parameters<typeof updateSetupItem>[2]) {
    startTransition(() => {
      void updateSetupItem(slug, item.id, patch);
    });
  }

  return (
    <div
      className={`rounded-lg border bg-white p-3 transition-opacity dark:bg-zinc-900 ${
        pending ? "opacity-60" : ""
      } ${overdue ? "border-red-300 dark:border-red-900" : "border-zinc-200 dark:border-zinc-800"}`}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-12 md:items-start">
        <div className="md:col-span-5">
          <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {item.label}
          </div>
          {item.description && (
            <p className="mt-0.5 text-xs text-zinc-500">{item.description}</p>
          )}
        </div>

        <div className="md:col-span-2">
          <label className="block text-[10px] font-medium uppercase tracking-wider text-zinc-400">
            Status
          </label>
          <select
            value={item.status}
            onChange={(e) =>
              update({
                status: e.target.value as ExternalSetupItem["status"],
              })
            }
            className={`mt-1 w-full rounded-md border border-zinc-200 px-2 py-1 text-xs font-medium dark:border-zinc-700 ${STATUS_STYLES[item.status]}`}
          >
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-2">
          <label className="block text-[10px] font-medium uppercase tracking-wider text-zinc-400">
            Owner
          </label>
          <select
            value={item.owner ?? ""}
            onChange={(e) =>
              update({
                owner: (e.target.value === ""
                  ? null
                  : e.target.value) as ExternalSetupItem["owner"],
              })
            }
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
          >
            <option value="">—</option>
            <option value="operator">Operator</option>
            <option value="va">VA</option>
            <option value="client">Client</option>
          </select>
        </div>

        <div className="md:col-span-3">
          <label className="block text-[10px] font-medium uppercase tracking-wider text-zinc-400">
            Expected by
            {overdue && (
              <span className="ml-2 text-red-600 dark:text-red-400">
                · overdue
              </span>
            )}
          </label>
          <input
            type="date"
            defaultValue={
              item.expectedBy
                ? new Date(item.expectedBy).toISOString().slice(0, 10)
                : ""
            }
            onBlur={(e) =>
              update({ expectedBy: e.target.value || null })
            }
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
          />
        </div>
      </div>

      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
          {item.notes ? "Notes ✎" : "+ Add notes"}
        </summary>
        <textarea
          defaultValue={item.notes ?? ""}
          onBlur={(e) => update({ notes: e.target.value || null })}
          rows={3}
          placeholder="Anything noteworthy — escalation paths, blockers, contact info, links…"
          className="mt-2 block w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-950"
        />
      </details>
    </div>
  );
}

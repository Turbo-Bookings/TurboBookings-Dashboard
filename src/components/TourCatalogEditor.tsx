"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  updateTourCatalog,
  type UpdateTourCatalogState,
} from "@/lib/actions/locations";
import type { Location, TourCatalogItem } from "@/lib/db/schema";

type EditableTour = TourCatalogItem & { _localId: string };

type Props = {
  location: Location;
};

const INITIAL_STATE = { ok: false as const, error: "" };

function emptyTour(): EditableTour {
  return {
    _localId: crypto.randomUUID(),
    key: "",
    displayName: "",
    fareharborItemId: "",
    price: 0,
    durationMinutes: 60,
  };
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
    >
      {pending ? "Saving…" : "Save tour catalog"}
    </button>
  );
}

export function TourCatalogEditor({ location }: Props) {
  const initial: EditableTour[] = (location.fareharborTourCatalog ?? []).map(
    (t) => ({ ...t, _localId: crypto.randomUUID() }),
  );
  const [tours, setTours] = useState<EditableTour[]>(initial);

  const boundAction = updateTourCatalog.bind(null, location.slug);
  const [state, formAction] = useActionState<UpdateTourCatalogState, FormData>(
    boundAction,
    INITIAL_STATE,
  );
  const rowErrors = !state.ok ? state.rowErrors ?? {} : {};

  function updateRow(localId: string, patch: Partial<EditableTour>) {
    setTours((prev) =>
      prev.map((t) => (t._localId === localId ? { ...t, ...patch } : t)),
    );
  }

  function removeRow(localId: string) {
    setTours((prev) => prev.filter((t) => t._localId !== localId));
  }

  // Strip the local React-key field before sending; the server schema doesn't
  // accept extra properties.
  const serializedTours = JSON.stringify(
    tours.map((t) => {
      const { _localId, ...rest } = t;
      void _localId;
      return rest;
    }),
  );

  return (
    <form action={formAction} className="space-y-4">
      {tours.length === 0 ? (
        <div className="rounded-md border-2 border-dashed border-zinc-200 bg-zinc-50/50 p-6 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/30">
          No tours yet. Add one below.
        </div>
      ) : (
        <div className="space-y-3">
          {tours.map((tour, idx) => (
            <TourRow
              key={tour._localId}
              tour={tour}
              errors={rowErrors[idx]}
              onChange={(patch) => updateRow(tour._localId, patch)}
              onRemove={() => removeRow(tour._localId)}
            />
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 pt-2">
        <button
          type="button"
          onClick={() => setTours((prev) => [...prev, emptyTour()])}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          <span className="text-base leading-none">+</span> Add tour
        </button>

        <div className="flex items-center gap-3">
          {state.ok && (
            <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
              ✓ Saved
            </span>
          )}
          {!state.ok && state.error && (
            <span className="text-sm font-medium text-red-600 dark:text-red-400">
              {state.error}
            </span>
          )}
          <SubmitButton />
        </div>
      </div>

      <input type="hidden" name="tourCatalog" value={serializedTours} />
    </form>
  );
}

type TourRowProps = {
  tour: EditableTour;
  errors?: Record<string, string>;
  onChange: (patch: Partial<EditableTour>) => void;
  onRemove: () => void;
};

function TourRow({ tour, errors, onChange, onRemove }: TourRowProps) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
        <Cell label="Key" error={errors?.key} className="md:col-span-2">
          <input
            type="text"
            value={tour.key}
            onChange={(e) => onChange({ key: e.target.value })}
            placeholder="atv1h"
            className="block w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-950"
          />
        </Cell>
        <Cell label="Display name" error={errors?.displayName} className="md:col-span-4">
          <input
            type="text"
            value={tour.displayName}
            onChange={(e) => onChange({ displayName: e.target.value })}
            placeholder="1-Hour ATV Tour"
            className="block w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-950"
          />
        </Cell>
        <Cell label="FH item ID" error={errors?.fareharborItemId} className="md:col-span-2">
          <input
            type="text"
            value={tour.fareharborItemId}
            onChange={(e) => onChange({ fareharborItemId: e.target.value })}
            placeholder="724641"
            className="block w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-950"
          />
        </Cell>
        <Cell label="Price ($)" error={errors?.price} className="md:col-span-1">
          <input
            type="number"
            min={0}
            step="1"
            value={tour.price}
            onChange={(e) => onChange({ price: Number(e.target.value) })}
            className="block w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-950"
          />
        </Cell>
        <Cell label="Duration (min)" error={errors?.durationMinutes} className="md:col-span-2">
          <input
            type="number"
            min={0}
            step="5"
            value={tour.durationMinutes}
            onChange={(e) =>
              onChange({ durationMinutes: Number(e.target.value) })
            }
            className="block w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-950"
          />
        </Cell>
        <div className="md:col-span-1 md:flex md:items-end md:justify-end">
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove tour"
            title="Remove tour"
            className="rounded-md px-2 py-1.5 text-sm text-zinc-500 transition-colors hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950 dark:hover:text-red-400"
          >
            ×
          </button>
        </div>
      </div>

      <div className="mt-3">
        <Cell label="Flow override" error={errors?.flowOverride}>
          <input
            type="text"
            value={tour.flowOverride ?? ""}
            onChange={(e) => onChange({ flowOverride: e.target.value })}
            placeholder="Optional — only set if this tour needs a non-default FareHarbor flow (e.g. 'no')"
            className="block w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-950"
          />
        </Cell>
      </div>
    </div>
  );
}

function Cell({
  label,
  error,
  className,
  children,
}: {
  label: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
        {label}
      </label>
      <div className="mt-1">{children}</div>
      {error && (
        <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { SaveResourceReqState } from "@/lib/actions/items";
import type {
  ResourceColumn,
  ResourceRequirementCell,
  ResourceRowCustomerType,
} from "@/lib/data/items";

type Props = {
  customerTypes: ResourceRowCustomerType[];
  resources: ResourceColumn[];
  initialCells: ResourceRequirementCell[];
  saveAction: (
    prev: SaveResourceReqState | null,
    formData: FormData,
  ) => Promise<SaveResourceReqState>;
};

function cellKey(customerTypeId: string, resourceId: string): string {
  return `${customerTypeId}:${resourceId}`;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
    >
      {pending ? "Saving…" : "Save resource requirements"}
    </button>
  );
}

export function ResourceRequirementsEditor({
  customerTypes,
  resources,
  initialCells,
  saveAction,
}: Props) {
  // Cell values held as strings (blank = no requirement) keyed by ct:resource.
  const [values, setValues] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const c of initialCells) {
      seed[cellKey(c.customerTypeId, c.resourceId)] =
        c.quantityConsumed.toString();
    }
    return seed;
  });
  const [state, formAction] = useActionState<
    SaveResourceReqState | null,
    FormData
  >(saveAction, null);

  function setCell(key: string, raw: string) {
    setValues((prev) => ({ ...prev, [key]: raw }));
  }

  // Payload: every ct × resource cell, blank → 0 (server treats 0 as "clear").
  const payload = customerTypes.flatMap((ct) =>
    resources.map((res) => {
      const key = cellKey(ct.customerTypeId, res.id);
      const raw = values[key]?.trim() ?? "";
      const n = raw === "" ? 0 : Number(raw);
      return {
        customerTypeId: ct.customerTypeId,
        resourceId: res.id,
        quantityConsumed: Number.isFinite(n) ? Math.round(n) : NaN,
      };
    }),
  );

  if (customerTypes.length === 0) {
    return (
      <div className="rounded-lg border-2 border-dashed border-zinc-200 bg-zinc-50/50 p-12 text-center dark:border-zinc-800 dark:bg-zinc-900/30">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
          No customer types on this tour yet
        </h3>
        <p className="mx-auto mt-1.5 max-w-md text-xs text-zinc-500">
          Add customer types on the Pricing matrix first — each one becomes a
          row here, where you set how many of each resource it consumes.
        </p>
      </div>
    );
  }

  if (resources.length === 0) {
    return (
      <div className="rounded-lg border-2 border-dashed border-zinc-200 bg-zinc-50/50 p-12 text-center dark:border-zinc-800 dark:bg-zinc-900/30">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
          No resources at this location yet
        </h3>
        <p className="mx-auto mt-1.5 max-w-md text-xs text-zinc-500">
          Add resource pools (ATVs, UTVs, guides) on the Resources tab first,
          then come back to map how much each customer type consumes.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="cells" value={JSON.stringify(payload)} />

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full divide-y divide-zinc-200 dark:divide-zinc-800">
          <thead className="bg-zinc-50 dark:bg-zinc-900/50">
            <tr className="text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
              <th className="px-3 py-2">Customer type</th>
              {resources.map((res) => (
                <th key={res.id} className="px-3 py-2">
                  <span className="block text-zinc-700 dark:text-zinc-300">
                    {res.name}
                  </span>
                  <span className="block font-normal normal-case text-zinc-400">
                    cap {res.maxConcurrentUses}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 bg-white dark:divide-zinc-800 dark:bg-zinc-900">
            {customerTypes.map((ct) => (
              <tr
                key={ct.customerTypeId}
                className={ct.archived ? "opacity-60" : ""}
              >
                <td className="px-3 py-2 align-top">
                  <div className="flex items-center gap-2">
                    <div
                      aria-hidden
                      className="h-4 w-1 rounded-full"
                      style={{ background: ct.ticketColor ?? "#d4d4d8" }}
                    />
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {ct.singular}
                    </span>
                    {ct.archived && (
                      <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                        Archived
                      </span>
                    )}
                  </div>
                </td>
                {resources.map((res) => {
                  const key = cellKey(ct.customerTypeId, res.id);
                  const err = state?.cellErrors[key];
                  return (
                    <td key={res.id} className="px-3 py-2 align-top">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        placeholder="—"
                        aria-label={`${ct.singular} consumes ${res.name}`}
                        value={values[key] ?? ""}
                        onChange={(e) => setCell(key, e.target.value)}
                        className={`w-16 rounded-md border bg-white px-2 py-1 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-zinc-900 ${
                          err
                            ? "border-red-400 dark:border-red-500"
                            : "border-zinc-300 dark:border-zinc-700"
                        }`}
                      />
                      {err && (
                        <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                          {err}
                        </p>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {state?.formError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {state.formError}
        </div>
      )}

      <div className="flex items-center gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <SubmitButton />
        {state?.ok && (
          <span className="text-sm text-green-600 dark:text-green-400">
            Saved
          </span>
        )}
      </div>
    </form>
  );
}

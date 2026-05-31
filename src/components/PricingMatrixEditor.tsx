"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { SavePricingState } from "@/lib/actions/items";

type EditableRow = {
  id: string;
  customerTypeId: string;
  customerTypeLabel: string;
  customerTypeColor: string | null;
  customerTypeArchived: boolean;
  // Inputs live as strings so partial typing doesn't fight number coercion.
  priceDollars: string;
  taxRatePercent: string;
  visibility: "visible" | "hidden";
  minQuantity: string;
  maxQuantity: string;
};

type Props = {
  initialRows: EditableRow[];
  saveAction: (
    prev: SavePricingState | null,
    formData: FormData,
  ) => Promise<SavePricingState>;
  removeRowAction: (rowCustomerTypeId: string) => Promise<void>;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
    >
      {pending ? "Saving…" : "Save pricing"}
    </button>
  );
}

function dollarsToCents(s: string): number {
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

function percentToBps(s: string): number | null {
  if (s.trim() === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

function intOrNull(s: string): number | null {
  if (s.trim() === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n);
}

export function PricingMatrixEditor({
  initialRows,
  saveAction,
  removeRowAction,
}: Props) {
  const [rows, setRows] = useState<EditableRow[]>(initialRows);
  const [state, formAction] = useActionState<SavePricingState | null, FormData>(
    saveAction,
    null,
  );

  function updateRow(id: string, patch: Partial<EditableRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  // Build the JSON payload the action expects, with parsed numbers.
  const payload = rows.map((r) => ({
    id: r.id,
    priceCents: dollarsToCents(r.priceDollars),
    taxRateBpsOverride: percentToBps(r.taxRatePercent),
    visibility: r.visibility,
    minQuantity: intOrNull(r.minQuantity) ?? 0,
    maxQuantity: intOrNull(r.maxQuantity),
  }));

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border-2 border-dashed border-zinc-200 bg-zinc-50/50 p-12 text-center dark:border-zinc-800 dark:bg-zinc-900/30">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
          No customer types on this tour yet
        </h3>
        <p className="mx-auto mt-1.5 max-w-md text-xs text-zinc-500">
          Add at least one customer type using the form above. Each one becomes
          a row in the pricing matrix.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="rows" value={JSON.stringify(payload)} />

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full divide-y divide-zinc-200 dark:divide-zinc-800">
          <thead className="bg-zinc-50 dark:bg-zinc-900/50">
            <tr className="text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
              <th className="px-3 py-2">Customer type</th>
              <th className="px-3 py-2">Price (USD)</th>
              <th className="px-3 py-2">Tax override</th>
              <th className="px-3 py-2">Min</th>
              <th className="px-3 py-2">Max</th>
              <th className="px-3 py-2">Visibility</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 bg-white dark:divide-zinc-800 dark:bg-zinc-900">
            {rows.map((row) => {
              const errs = state?.rowErrors[row.id] ?? {};
              return (
                <tr
                  key={row.id}
                  className={row.customerTypeArchived ? "opacity-60" : ""}
                >
                  <td className="px-3 py-2 align-top">
                    <div className="flex items-center gap-2">
                      <div
                        aria-hidden
                        className="h-4 w-1 rounded-full"
                        style={{
                          background: row.customerTypeColor ?? "#d4d4d8",
                        }}
                      />
                      <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {row.customerTypeLabel}
                      </span>
                      {row.customerTypeArchived && (
                        <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                          Archived
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={row.priceDollars}
                      onChange={(e) =>
                        updateRow(row.id, { priceDollars: e.target.value })
                      }
                      className={`w-28 rounded-md border bg-white px-2 py-1 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-zinc-900 ${
                        errs.priceCents
                          ? "border-red-400 dark:border-red-500"
                          : "border-zinc-300 dark:border-zinc-700"
                      }`}
                    />
                    {errs.priceCents && (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                        {errs.priceCents}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="relative w-24">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        placeholder="—"
                        value={row.taxRatePercent}
                        onChange={(e) =>
                          updateRow(row.id, {
                            taxRatePercent: e.target.value,
                          })
                        }
                        className={`w-full rounded-md border bg-white py-1 pl-2 pr-5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-zinc-900 ${
                          errs.taxRateBpsOverride
                            ? "border-red-400 dark:border-red-500"
                            : "border-zinc-300 dark:border-zinc-700"
                        }`}
                      />
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-zinc-400">
                        %
                      </span>
                    </div>
                    {errs.taxRateBpsOverride && (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                        {errs.taxRateBpsOverride}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={row.minQuantity}
                      onChange={(e) =>
                        updateRow(row.id, { minQuantity: e.target.value })
                      }
                      className={`w-16 rounded-md border bg-white px-2 py-1 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-zinc-900 ${
                        errs.minQuantity
                          ? "border-red-400 dark:border-red-500"
                          : "border-zinc-300 dark:border-zinc-700"
                      }`}
                    />
                    {errs.minQuantity && (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                        {errs.minQuantity}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      placeholder="—"
                      value={row.maxQuantity}
                      onChange={(e) =>
                        updateRow(row.id, { maxQuantity: e.target.value })
                      }
                      className={`w-16 rounded-md border bg-white px-2 py-1 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-zinc-900 ${
                        errs.maxQuantity
                          ? "border-red-400 dark:border-red-500"
                          : "border-zinc-300 dark:border-zinc-700"
                      }`}
                    />
                    {errs.maxQuantity && (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                        {errs.maxQuantity}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <select
                      value={row.visibility}
                      onChange={(e) =>
                        updateRow(row.id, {
                          visibility: e.target.value as "visible" | "hidden",
                        })
                      }
                      className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      <option value="visible">Visible</option>
                      <option value="hidden">Hidden</option>
                    </select>
                  </td>
                  <td className="px-3 py-2 align-top text-right">
                    <button
                      type="button"
                      onClick={async () => {
                        await removeRowAction(row.customerTypeId);
                        setRows((prev) => prev.filter((r) => r.id !== row.id));
                      }}
                      className="text-sm font-medium text-zinc-500 hover:text-red-600 dark:hover:text-red-400"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
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

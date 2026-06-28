"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { ScheduleFormState } from "@/lib/actions/schedules";
import type { ItemForSelect, ResourceSummary } from "@/lib/data/items";
import {
  compileWeekly,
  previewOccurrences,
  timeRange,
  WEEKDAYS,
  type WeekdayCode,
} from "@/lib/rrule/weekly";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

type Action = (
  prev: ScheduleFormState | null,
  formData: FormData,
) => Promise<ScheduleFormState>;

type Props = {
  action: Action;
  slug: string;
  items: ItemForSelect[];
  timezone: string | null;
  resourceSummaries: Record<string, ResourceSummary[]>;
  initialValues: ScheduleFormState["values"];
  cancelHref: string;
  submitLabel: string;
};

const inputCls = (err?: string) =>
  `block w-full rounded-md border bg-white px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-zinc-900 ${
    err
      ? "border-red-400 dark:border-red-500"
      : "border-zinc-300 dark:border-zinc-700"
  }`;
const labelCls = "block text-sm font-medium text-zinc-700 dark:text-zinc-300";
const errCls = "mt-1 text-xs font-medium text-red-600 dark:text-red-400";
const hintCls = "mt-1 text-xs text-zinc-500";

const STATUS_OPTIONS = [
  { value: "auto", label: "Auto — bookable until the lead-time cutoff" },
  { value: "on", label: "On — always bookable online" },
  { value: "off", label: "Off — operator-add only" },
];

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
    >
      {pending ? "Saving…" : label}
    </button>
  );
}

function mergeTimes(prev: string[], add: string[]): string[] {
  return [...new Set([...prev, ...add.filter((t) => TIME_RE.test(t))])].sort();
}

export function ScheduleForm({
  action,
  slug,
  items,
  timezone,
  resourceSummaries,
  initialValues,
  cancelHref,
  submitLabel,
}: Props) {
  const [state, formAction] = useActionState<ScheduleFormState | null, FormData>(
    action,
    null,
  );
  const errors = state?.errors ?? {};

  const [itemId, setItemId] = useState(initialValues.itemId);
  const [weekdays, setWeekdays] = useState<Set<string>>(
    () => new Set(initialValues.weekdays),
  );
  const [startTimes, setStartTimes] = useState<string[]>(() =>
    mergeTimes([], initialValues.startTimesLocal),
  );
  const [durationMinutes, setDuration] = useState(
    initialValues.durationMinutes,
  );
  const [capacityPerSlot, setCapacity] = useState(
    initialValues.capacityPerSlot,
  );
  const [status, setStatus] = useState(
    initialValues.defaultOnlineBookingStatus,
  );
  const [seasonStart, setSeasonStart] = useState(initialValues.seasonStart);
  const [seasonEnd, setSeasonEnd] = useState(initialValues.seasonEnd);
  const [materializeDaysAhead, setHorizon] = useState(
    initialValues.materializeDaysAhead,
  );
  const [active, setActive] = useState(initialValues.active);

  // Generator + manual-add local inputs.
  const [genFrom, setGenFrom] = useState("10:00");
  const [genTo, setGenTo] = useState("17:00");
  const [genEvery, setGenEvery] = useState("60");
  const [newTime, setNewTime] = useState("");

  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const selectedItem = itemsById.get(itemId);
  const isFixed = selectedItem?.capacityMode === "fixed";
  const pools = resourceSummaries[itemId] ?? [];

  function toggleDay(code: WeekdayCode) {
    setWeekdays((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function onItemChange(id: string) {
    setItemId(id);
    const dur = itemsById.get(id)?.defaultDurationMinutes;
    if (dur) setDuration(String(dur));
  }

  function runGenerator() {
    const generated = timeRange(genFrom, genTo, Number(genEvery));
    if (generated.length > 0) setStartTimes((prev) => mergeTimes(prev, generated));
  }

  function addManualTime() {
    if (TIME_RE.test(newTime)) {
      setStartTimes((prev) => mergeTimes(prev, [newTime]));
      setNewTime("");
    }
  }

  function removeTime(t: string) {
    setStartTimes((prev) => prev.filter((x) => x !== t));
  }

  const orderedDays = useMemo(
    () => WEEKDAYS.filter((d) => weekdays.has(d.code)).map((d) => d.code),
    [weekdays],
  );

  const preview = useMemo(() => {
    if (orderedDays.length === 0 || !seasonStart || startTimes.length === 0)
      return [];
    const rrule = compileWeekly({
      weekdays: orderedDays,
      seasonStart,
      seasonEnd: seasonEnd || undefined,
    });
    return previewOccurrences(rrule, startTimes, 6);
  }, [orderedDays, seasonStart, seasonEnd, startTimes]);

  return (
    <form action={formAction} className="space-y-6">
      {orderedDays.map((code) => (
        <input key={code} type="hidden" name="weekdays" value={code} />
      ))}
      {startTimes.map((t) => (
        <input key={t} type="hidden" name="startTimesLocal" value={t} />
      ))}

      {/* Tour */}
      <div>
        <label htmlFor="itemId" className={labelCls}>
          Tour
        </label>
        {items.length === 0 ? (
          <p className="mt-1 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            No tours yet — add one on the Tours tab before creating a schedule.
          </p>
        ) : (
          <select
            id="itemId"
            name="itemId"
            value={itemId}
            onChange={(e) => onItemChange(e.target.value)}
            className={`mt-1.5 ${inputCls(errors.itemId)}`}
          >
            <option value="" disabled>
              Select a tour…
            </option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
                {i.bookableOnline ? "" : " (not bookable online)"}
              </option>
            ))}
          </select>
        )}
        {errors.itemId && <p className={errCls}>{errors.itemId}</p>}
      </div>

      {/* Weekdays */}
      <div>
        <span className={labelCls}>Repeats on</span>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {WEEKDAYS.map((d) => {
            const on = weekdays.has(d.code);
            return (
              <button
                key={d.code}
                type="button"
                onClick={() => toggleDay(d.code)}
                aria-pressed={on}
                className={
                  on
                    ? "rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm"
                    : "rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                }
              >
                {d.short}
              </button>
            );
          })}
        </div>
        {errors.weekdays && <p className={errCls}>{errors.weekdays}</p>}
      </div>

      {/* Start times */}
      <div>
        <span className={labelCls}>Start times</span>
        <p className={hintCls}>
          Each time becomes a slot on every selected day. Local to{" "}
          {timezone ? <span className="font-mono">{timezone}</span> : "this location"}.
        </p>

        {/* Generator */}
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-zinc-200 bg-zinc-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
          <div>
            <label className="block text-xs text-zinc-500">From</label>
            <input
              type="time"
              value={genFrom}
              onChange={(e) => setGenFrom(e.target.value)}
              className={`mt-1 ${inputCls()}`}
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500">To</label>
            <input
              type="time"
              value={genTo}
              onChange={(e) => setGenTo(e.target.value)}
              className={`mt-1 ${inputCls()}`}
            />
          </div>
          <div className="w-24">
            <label className="block text-xs text-zinc-500">Every (min)</label>
            <input
              type="number"
              min={1}
              value={genEvery}
              onChange={(e) => setGenEvery(e.target.value)}
              className={`mt-1 ${inputCls()}`}
            />
          </div>
          <button
            type="button"
            onClick={runGenerator}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Generate
          </button>
        </div>

        {/* Chips */}
        {startTimes.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {startTimes.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 font-mono text-sm text-blue-700 dark:bg-blue-950 dark:text-blue-300"
              >
                {t}
                <button
                  type="button"
                  onClick={() => removeTime(t)}
                  aria-label={`Remove ${t}`}
                  className="text-blue-400 hover:text-blue-700 dark:hover:text-blue-200"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Manual add */}
        <div className="mt-2 flex items-end gap-2">
          <input
            type="time"
            value={newTime}
            onChange={(e) => setNewTime(e.target.value)}
            className={`w-40 ${inputCls()}`}
          />
          <button
            type="button"
            onClick={addManualTime}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            + Add time
          </button>
        </div>
        {errors.startTimesLocal && (
          <p className={errCls}>{errors.startTimesLocal}</p>
        )}
      </div>

      {/* Duration + capacity (capacity depends on tour mode) */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <label htmlFor="durationMinutes" className={labelCls}>
            Duration (minutes)
          </label>
          <input
            id="durationMinutes"
            name="durationMinutes"
            type="number"
            min={1}
            value={durationMinutes}
            onChange={(e) => setDuration(e.target.value)}
            className={`mt-1.5 ${inputCls(errors.durationMinutes)}`}
          />
          {errors.durationMinutes && (
            <p className={errCls}>{errors.durationMinutes}</p>
          )}
        </div>

        {isFixed ? (
          <div>
            <label htmlFor="capacityPerSlot" className={labelCls}>
              Capacity per slot
            </label>
            <input
              id="capacityPerSlot"
              name="capacityPerSlot"
              type="number"
              min={1}
              placeholder="8"
              value={capacityPerSlot}
              onChange={(e) => setCapacity(e.target.value)}
              className={`mt-1.5 ${inputCls(errors.capacityPerSlot)}`}
            />
            <p className={hintCls}>This tour uses a fixed capacity.</p>
            {errors.capacityPerSlot && (
              <p className={errCls}>{errors.capacityPerSlot}</p>
            )}
          </div>
        ) : (
          <div>
            <span className={labelCls}>Capacity</span>
            {pools.length > 0 ? (
              <p className="mt-1.5 rounded-md border border-zinc-200 bg-zinc-50/60 p-3 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400">
                Limited by this tour&apos;s resources:{" "}
                <span className="font-medium">
                  {pools.map((p) => `${p.name} (${p.maxConcurrentUses})`).join(", ")}
                </span>
                .{" "}
                <Link
                  href={`/locations/${slug}/catalog/tours/${itemId}/resources`}
                  className="text-blue-600 hover:text-blue-800 dark:text-blue-400"
                >
                  Edit resources
                </Link>
              </p>
            ) : (
              <p className="mt-1.5 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                This tour is resource-based but has no resource requirements yet
                — it won&apos;t be bookable until you add them on the{" "}
                <Link
                  href={`/locations/${slug}/catalog/tours/${itemId}/resources`}
                  className="font-medium underline"
                >
                  Resources tab
                </Link>
                .
              </p>
            )}
          </div>
        )}
      </div>

      {/* Online status */}
      <div>
        <label htmlFor="defaultOnlineBookingStatus" className={labelCls}>
          Online booking
        </label>
        <select
          id="defaultOnlineBookingStatus"
          name="defaultOnlineBookingStatus"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className={`mt-1.5 ${inputCls(errors.defaultOnlineBookingStatus)}`}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {errors.defaultOnlineBookingStatus && (
          <p className={errCls}>{errors.defaultOnlineBookingStatus}</p>
        )}
      </div>

      {/* Season window */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <label htmlFor="seasonStart" className={labelCls}>
            Season start
          </label>
          <input
            id="seasonStart"
            name="seasonStart"
            type="date"
            value={seasonStart}
            onChange={(e) => setSeasonStart(e.target.value)}
            className={`mt-1.5 ${inputCls(errors.seasonStart)}`}
          />
          {errors.seasonStart && <p className={errCls}>{errors.seasonStart}</p>}
        </div>
        <div>
          <label htmlFor="seasonEnd" className={labelCls}>
            Season end{" "}
            <span className="text-xs font-normal text-zinc-400">(optional)</span>
          </label>
          <input
            id="seasonEnd"
            name="seasonEnd"
            type="date"
            value={seasonEnd}
            onChange={(e) => setSeasonEnd(e.target.value)}
            className={`mt-1.5 ${inputCls(errors.seasonEnd)}`}
          />
          <p className={hintCls}>Leave blank to run indefinitely.</p>
          {errors.seasonEnd && <p className={errCls}>{errors.seasonEnd}</p>}
        </div>
      </div>

      {/* Advanced */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <label htmlFor="materializeDaysAhead" className={labelCls}>
            Generate days ahead
          </label>
          <input
            id="materializeDaysAhead"
            name="materializeDaysAhead"
            type="number"
            min={1}
            max={365}
            value={materializeDaysAhead}
            onChange={(e) => setHorizon(e.target.value)}
            className={`mt-1.5 ${inputCls(errors.materializeDaysAhead)}`}
          />
          <p className={hintCls}>
            How far ahead concrete slots get generated (Sprint D).
          </p>
          {errors.materializeDaysAhead && (
            <p className={errCls}>{errors.materializeDaysAhead}</p>
          )}
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              name="active"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
            />
            Active
          </label>
        </div>
      </div>

      {/* Live preview */}
      <div className="rounded-md border border-zinc-200 bg-zinc-50/60 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Next slots
        </p>
        {preview.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">
            Pick days, add start times, and set a season start to preview.
          </p>
        ) : (
          <ul className="mt-2 space-y-1">
            {preview.map((label) => (
              <li
                key={label}
                className="font-mono text-sm text-zinc-700 dark:text-zinc-300"
              >
                {label}
              </li>
            ))}
          </ul>
        )}
      </div>

      {errors.form && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {errors.form}
        </div>
      )}

      <div className="flex items-center gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <SubmitButton label={submitLabel} />
        <Link
          href={cancelHref}
          className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}

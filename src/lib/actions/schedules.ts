"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { recordAudit } from "@/lib/audit";
import { availabilities, availabilitySchedules, getDb, items } from "@/lib/db";
import {
  loadBlackoutKeySet,
  materializeScheduleRow,
} from "@/lib/availability/generate";
import { getLocationBySlug } from "@/lib/data/locations";
import { getScheduleById } from "@/lib/data/schedules";
import { compileWeekly, type WeekdayCode } from "@/lib/rrule/weekly";
import type { AvailabilitySchedule } from "@/lib/db/schema";

// (Re)generate concrete slots for a schedule; never let a generation hiccup
// break the operator's save — the nightly cron reconciles either way.
async function safeMaterialize(
  schedule: AvailabilitySchedule,
  location: { id: string; timezone: string | null },
): Promise<void> {
  try {
    const keys = await loadBlackoutKeySet(location.id, schedule.itemId);
    await materializeScheduleRow(schedule, location.timezone, new Date(), keys);
  } catch (err) {
    console.error("materialize after schedule mutation failed", err);
  }
}

const VALID_WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const VALID_STATUS = ["on", "off", "auto"] as const;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TIMES = 48;

type FieldErrors = Partial<
  Record<
    | "itemId"
    | "weekdays"
    | "startTimesLocal"
    | "durationMinutes"
    | "capacityPerSlot"
    | "defaultOnlineBookingStatus"
    | "seasonStart"
    | "seasonEnd"
    | "materializeDaysAhead"
    | "form",
    string
  >
>;

export type ScheduleFormState = {
  ok: boolean;
  errors: FieldErrors;
  values: {
    itemId: string;
    weekdays: string[];
    startTimesLocal: string[];
    durationMinutes: string;
    capacityPerSlot: string;
    defaultOnlineBookingStatus: string;
    seasonStart: string;
    seasonEnd: string;
    materializeDaysAhead: string;
    active: boolean;
  };
};

function parseFormData(formData: FormData): ScheduleFormState["values"] {
  return {
    itemId: String(formData.get("itemId") ?? "").trim(),
    weekdays: formData.getAll("weekdays").map(String),
    startTimesLocal: formData
      .getAll("startTimesLocal")
      .map((t) => String(t).trim())
      .filter(Boolean),
    durationMinutes: String(formData.get("durationMinutes") ?? "").trim(),
    capacityPerSlot: String(formData.get("capacityPerSlot") ?? "").trim(),
    defaultOnlineBookingStatus: String(
      formData.get("defaultOnlineBookingStatus") ?? "auto",
    ).trim(),
    seasonStart: String(formData.get("seasonStart") ?? "").trim(),
    seasonEnd: String(formData.get("seasonEnd") ?? "").trim(),
    materializeDaysAhead: String(
      formData.get("materializeDaysAhead") ?? "540",
    ).trim(),
    active: formData.get("active") != null,
  };
}

// Mode-independent validation. Capacity is validated separately once we know
// the selected tour's capacity mode.
function validateBase(values: ScheduleFormState["values"]): FieldErrors {
  const errors: FieldErrors = {};

  if (!values.itemId) errors.itemId = "Pick a tour";

  const days = values.weekdays.filter((d) => VALID_WEEKDAYS.includes(d));
  if (days.length === 0) errors.weekdays = "Pick at least one day";

  if (values.startTimesLocal.length === 0)
    errors.startTimesLocal = "Add at least one start time";
  else if (values.startTimesLocal.some((t) => !TIME_RE.test(t)))
    errors.startTimesLocal = "Times must be HH:MM (24-hour)";
  else if (new Set(values.startTimesLocal).size > MAX_TIMES)
    errors.startTimesLocal = `Too many times (max ${MAX_TIMES})`;

  const dur = Number(values.durationMinutes);
  if (!values.durationMinutes) errors.durationMinutes = "Required";
  else if (!Number.isInteger(dur) || dur < 1 || dur > 1440)
    errors.durationMinutes = "Minutes between 1 and 1440";

  if (!VALID_STATUS.includes(values.defaultOnlineBookingStatus as never))
    errors.defaultOnlineBookingStatus = "Invalid status";

  if (!DATE_RE.test(values.seasonStart))
    errors.seasonStart = "Pick a season start date";

  if (values.seasonEnd) {
    if (!DATE_RE.test(values.seasonEnd)) errors.seasonEnd = "Invalid date";
    else if (values.seasonEnd < values.seasonStart)
      errors.seasonEnd = "End must be on or after the start";
  }

  const horizon = Number(values.materializeDaysAhead);
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > 1095)
    errors.materializeDaysAhead = "Days between 1 and 1095";

  return errors;
}

function uniqueSortedTimes(times: string[]): string[] {
  return [...new Set(times.filter((t) => TIME_RE.test(t)))].sort();
}

// Verify item belongs to location; returns its name + capacity mode (or null).
async function itemInLocation(
  itemId: string,
  locationId: string,
): Promise<{ name: string; capacityMode: "resource_based" | "fixed" } | null> {
  const db = getDb();
  const rows = await db
    .select({ name: items.name, capacityMode: items.capacityMode })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.locationId, locationId)))
    .limit(1);
  return rows[0] ?? null;
}

// Capacity only applies to fixed-mode tours; resource_based stores null.
function resolveCapacity(
  values: ScheduleFormState["values"],
  mode: "resource_based" | "fixed",
): { error?: string; value: number | null } {
  if (mode !== "fixed") return { value: null };
  const cap = Number(values.capacityPerSlot);
  if (!values.capacityPerSlot)
    return { error: "Required for fixed-capacity tours", value: null };
  if (!Number.isInteger(cap) || cap < 1 || cap > 100_000)
    return { error: "Whole number, at least 1", value: null };
  return { value: cap };
}

export async function createSchedule(
  slug: string,
  _prev: ScheduleFormState | null,
  formData: FormData,
): Promise<ScheduleFormState> {
  const values = parseFormData(formData);
  const errors = validateBase(values);
  if (Object.keys(errors).length > 0) return { ok: false, errors, values };

  const location = await getLocationBySlug(slug);
  if (!location)
    return { ok: false, errors: { form: "Location not found" }, values };

  const item = await itemInLocation(values.itemId, location.id);
  if (!item) return { ok: false, errors: { itemId: "Tour not found" }, values };

  const capacity = resolveCapacity(values, item.capacityMode);
  if (capacity.error)
    return { ok: false, errors: { capacityPerSlot: capacity.error }, values };

  const rruleText = compileWeekly({
    weekdays: values.weekdays as WeekdayCode[],
    seasonStart: values.seasonStart,
    seasonEnd: values.seasonEnd || undefined,
  });
  if (!rruleText)
    return { ok: false, errors: { weekdays: "Pick at least one day" }, values };

  const times = uniqueSortedTimes(values.startTimesLocal);
  const db = getDb();
  const created = await db
    .insert(availabilitySchedules)
    .values({
      itemId: values.itemId,
      rruleText,
      startTimesLocal: times,
      durationMinutes: Number(values.durationMinutes),
      capacityPerSlot: capacity.value,
      defaultOnlineBookingStatus:
        values.defaultOnlineBookingStatus as (typeof VALID_STATUS)[number],
      materializeDaysAhead: Number(values.materializeDaysAhead),
      active: values.active,
    })
    .returning();

  if (created[0]) await safeMaterialize(created[0], location);

  await recordAudit({
    slug,
    action: "catalog.schedule.create",
    summary: `Created schedule for "${item.name}" (${times.length} start time${times.length === 1 ? "" : "s"})`,
    payload: { itemId: values.itemId, rruleText, times },
  });

  revalidatePath(`/locations/${slug}/catalog/schedule`);
  redirect(`/locations/${slug}/catalog/schedule`);
}

export async function updateSchedule(
  slug: string,
  id: string,
  _prev: ScheduleFormState | null,
  formData: FormData,
): Promise<ScheduleFormState> {
  const values = parseFormData(formData);
  const errors = validateBase(values);
  if (Object.keys(errors).length > 0) return { ok: false, errors, values };

  const location = await getLocationBySlug(slug);
  if (!location)
    return { ok: false, errors: { form: "Location not found" }, values };

  const existing = await getScheduleById(id, location.id);
  if (!existing)
    return { ok: false, errors: { form: "Schedule not found" }, values };

  const item = await itemInLocation(values.itemId, location.id);
  if (!item) return { ok: false, errors: { itemId: "Tour not found" }, values };

  const capacity = resolveCapacity(values, item.capacityMode);
  if (capacity.error)
    return { ok: false, errors: { capacityPerSlot: capacity.error }, values };

  const rruleText = compileWeekly({
    weekdays: values.weekdays as WeekdayCode[],
    seasonStart: values.seasonStart,
    seasonEnd: values.seasonEnd || undefined,
  });
  if (!rruleText)
    return { ok: false, errors: { weekdays: "Pick at least one day" }, values };

  const times = uniqueSortedTimes(values.startTimesLocal);
  const db = getDb();
  const updated = await db
    .update(availabilitySchedules)
    .set({
      itemId: values.itemId,
      rruleText,
      startTimesLocal: times,
      durationMinutes: Number(values.durationMinutes),
      capacityPerSlot: capacity.value,
      defaultOnlineBookingStatus:
        values.defaultOnlineBookingStatus as (typeof VALID_STATUS)[number],
      materializeDaysAhead: Number(values.materializeDaysAhead),
      active: values.active,
      updatedAt: new Date(),
    })
    .where(eq(availabilitySchedules.id, id))
    .returning();

  if (updated[0]) await safeMaterialize(updated[0], location);

  await recordAudit({
    slug,
    action: "catalog.schedule.update",
    summary: `Updated schedule for "${item.name}" (${times.length} start time${times.length === 1 ? "" : "s"})`,
    payload: { id, rruleText, times },
  });

  revalidatePath(`/locations/${slug}/catalog/schedule`);
  redirect(`/locations/${slug}/catalog/schedule`);
}

export async function deleteSchedule(
  slug: string,
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };

  const existing = await getScheduleById(id, location.id);
  if (!existing) return { ok: false, error: "Schedule not found" };

  const db = getDb();
  // No FK cascade on availabilities.schedule_id, so remove its slots explicitly.
  await db.delete(availabilities).where(eq(availabilities.scheduleId, id));
  await db.delete(availabilitySchedules).where(eq(availabilitySchedules.id, id));

  await recordAudit({
    slug,
    action: "catalog.schedule.delete",
    summary: "Deleted an availability schedule",
    payload: { id },
  });

  revalidatePath(`/locations/${slug}/catalog/schedule`);
  return { ok: true };
}

export async function setScheduleActive(
  slug: string,
  id: string,
  active: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };

  const existing = await getScheduleById(id, location.id);
  if (!existing) return { ok: false, error: "Schedule not found" };

  const db = getDb();
  await db
    .update(availabilitySchedules)
    .set({ active, updatedAt: new Date() })
    .where(eq(availabilitySchedules.id, id));

  // Regenerate (active) or clear future slots (paused).
  await safeMaterialize({ ...existing, active }, location);

  await recordAudit({
    slug,
    action: "catalog.schedule.update",
    summary: `${active ? "Activated" : "Paused"} an availability schedule`,
    payload: { id, active },
  });

  revalidatePath(`/locations/${slug}/catalog/schedule`);
  return { ok: true };
}

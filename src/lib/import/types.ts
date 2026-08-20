// Shared shapes for the FareHarbor import. The dry run and the commit produce
// the SAME report shape, so what the operator approves is what gets written.

export type Severity = "error" | "warning";

export type IssueCode =
  // blocking
  | "missing_booking_ref"
  | "duplicate_ref_in_file"
  | "missing_datetime"
  | "bad_datetime"
  | "missing_total"
  | "bad_money"
  | "unmapped_item"
  | "no_customer_types"
  | "zero_quantity"
  | "unmatched_slot"
  | "insufficient_capacity"
  | "db_error"
  // non-blocking
  | "cancelled_in_source"
  | "already_imported"
  | "rider_mix_estimated"
  | "missing_email"
  | "missing_name"
  | "bad_phone"
  | "dst_shifted"
  | "past_datetime"
  | "slot_will_be_created"
  | "ragged_row"
  // The export had no "Total" column, so the total was derived as Paid + Due.
  // Non-blocking, but surfaced so the operator sees the money was computed
  // rather than read straight from the file.
  | "total_derived_from_paid_plus_due"
  // Imported into a slot that is already at or over capacity, under
  // --allow-overbook. Non-blocking by design: the booking exists in the source
  // system whether or not we record it. These are the rows to call.
  | "overbooked_slot";

export type RowIssue = {
  code: IssueCode;
  severity: Severity;
  detail?: string;
};

export const BLOCKING: ReadonlySet<IssueCode> = new Set<IssueCode>([
  "missing_booking_ref",
  "duplicate_ref_in_file",
  "missing_datetime",
  "bad_datetime",
  "missing_total",
  "bad_money",
  "unmapped_item",
  "no_customer_types",
  "zero_quantity",
  "unmatched_slot",
  "insufficient_capacity",
  "db_error",
]);

/** One resolved line of an imported booking. */
export type PlannedLine = {
  customerTypeId: string;
  customerTypeName: string;
  quantity: number;
  unitPriceCents: number;
};

/** A single booking, fully resolved against our catalog and ready to write. */
export type PlannedRow = {
  /** 1-based line number in the source file, for operator reference. */
  sourceLine: number;
  externalRef: string;
  rawRef: string;

  itemId: string | null;
  itemName: string;

  /** UTC instant of the tour start. */
  startsAt: Date | null;
  /** Same instant rendered in location-local time — the operator's sanity check. */
  startsAtLocal: string;

  /** Existing slot, when one matched. */
  availabilityId: string | null;
  /** True when the commit would create a one-off slot for this instant. */
  willCreateSlot: boolean;

  firstName: string | null;
  lastName: string | null;
  emailLower: string;
  /** True when we invented the address because the export had none. */
  syntheticEmail: boolean;
  phoneE164: string | null;

  lines: PlannedLine[];
  units: number;

  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  depositPaidCents: number;
  balanceDueCents: number;
  /** Set only when the line prices don't sum to the source subtotal. */
  subtotalCentsOverride: number | null;

  notes: string | null;
  issues: RowIssue[];
  /** Convenience: any blocking issue present. */
  blocked: boolean;
  /** Already present in the DB under this external_ref. */
  alreadyImported: boolean;
};

export type SlotPressure = {
  availabilityId: string | null;
  startsAtLocal: string;
  existingUnits: number;
  incomingUnits: number;
  capacity: number | null;
  over: boolean;
};

export type ImportPlan = {
  locationSlug: string;
  timezone: string;
  fileName: string;
  delimiter: string;
  headers: string[];
  /** Rows in the file, excluding blank/summary rows. */
  sourceRows: number;
  raggedRows: number[];
  rows: PlannedRow[];
  slotPressure: SlotPressure[];
  /** Distinct source tour names → our item, for the operator to confirm. */
  itemMapping: { sourceName: string; itemId: string | null; itemName: string | null; bookings: number }[];
  totals: {
    importable: number;
    blocked: number;
    alreadyImported: number;
    cancelled: number;
    units: number;
    totalCents: number;
    depositPaidCents: number;
    balanceDueCents: number;
    slotsToCreate: number;
  };
};

export type RowOutcome = {
  externalRef: string;
  status: "created" | "duplicate_skipped" | "error";
  bookingId?: string;
  displayNumber?: string;
  error?: string;
};

export type ImportResult = {
  created: number;
  duplicates: number;
  errors: number;
  slotsCreated: number;
  displayNumberRange: [string, string] | null;
  outcomes: RowOutcome[];
};

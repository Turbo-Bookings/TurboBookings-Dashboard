// Human labels for bookings.source. `api` is what the FareHarbor importer
// writes — staff should never see the raw enum value on a manifest or booking
// detail screen.
const LABELS: Record<string, string> = {
  online: "Online",
  direct: "Operator",
  api: "Imported",
};

export function sourceLabel(source: string): string {
  return LABELS[source] ?? source;
}

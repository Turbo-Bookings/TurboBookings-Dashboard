import { TabPlaceholder } from "@/components/TabPlaceholder";

export default function ActivityPage() {
  return (
    <TabPlaceholder
      name="Activity"
      description="Audit log of every config change to this location. Diff highlighting, filterable by user / key / time, per-row revert."
      phase="Phase 1"
    />
  );
}

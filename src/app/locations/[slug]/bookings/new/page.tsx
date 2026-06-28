import { TabPlaceholder } from "@/components/TabPlaceholder";

export default function NewBookingPlaceholder() {
  return (
    <TabPlaceholder
      name="New booking"
      description="Operator manual / phone booking creation (pick tour → date/time → riders → customer → charge a card or mark pay-at-venue). Lands in OB-3."
      phase="Phase 1"
    />
  );
}

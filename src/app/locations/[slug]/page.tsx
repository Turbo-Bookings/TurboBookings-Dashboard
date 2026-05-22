import { TabPlaceholder } from "@/components/TabPlaceholder";

// Default landing tab. Branding & Tours is the most-edited surface during
// onboarding so it's the natural first thing to see. Content lands in the
// next commit (logo upload, color extraction, font picker, tour catalog).
export default function BrandingPage() {
  return (
    <TabPlaceholder
      name="Branding & Tours"
      description="Logo + color extraction, font picker, brand identity, tour catalog, AI chat knowledge base, social handles."
      phase="Phase 1"
    />
  );
}

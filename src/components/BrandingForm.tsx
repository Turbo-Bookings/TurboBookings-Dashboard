"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Field } from "@/components/Field";
import {
  updateLocationBranding,
  type UpdateBrandingState,
} from "@/lib/actions/locations";
import type { Location } from "@/lib/db/schema";

type Props = {
  location: Location;
};

const INITIAL_STATE = { ok: false as const, errors: {} as Record<string, string> };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
    >
      {pending ? "Saving…" : "Save"}
    </button>
  );
}

function SavedIndicator({ saved }: { saved: boolean }) {
  // Visible whenever the latest action state is a successful save. Cleared
  // implicitly when the user submits again (action returns a fresh state).
  // Phase 2 can replace this with a fading toast.
  if (!saved) return null;
  return (
    <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
      ✓ Saved
    </span>
  );
}

export function BrandingForm({ location }: Props) {
  const updateForLocation = updateLocationBranding.bind(null, location.slug);
  const [state, formAction] = useActionState<UpdateBrandingState, FormData>(
    updateForLocation,
    INITIAL_STATE,
  );
  const errors = "errors" in state ? state.errors : {};

  return (
    <form action={formAction} className="space-y-10">
      <Section
        title="Brand identity"
        description="The public-facing name and legal entity for this location."
      >
        <Field
          label="Display brand name"
          name="brandDisplayName"
          defaultValue={location.brandDisplayName ?? ""}
          error={errors.brandDisplayName}
          hint="What users see — e.g. 'Takeovers', 'HTown ATV Rentals'."
        />
        <Field
          label="City / location label"
          name="brandLocationLabel"
          defaultValue={location.brandLocationLabel ?? ""}
          error={errors.brandLocationLabel}
          hint="Short label used across the site — e.g. 'Miami', 'Houston'."
        />
        <Field
          label="Legal entity"
          name="brandLegalName"
          defaultValue={location.brandLegalName ?? ""}
          error={errors.brandLegalName}
          hint="LLC name. Appears in CAN-SPAM footers, privacy policy, schema.org."
        />
      </Section>

      <Section
        title="Contact"
        description="The phone, email, and address publicly associated with this location."
      >
        <Field
          label="Address"
          name="contactAddress"
          defaultValue={location.contactAddress ?? ""}
          error={errors.contactAddress}
          hint="Single line. Used in CAN-SPAM footer, contact page, schema.org."
        />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field
            label="Display phone"
            name="contactPhone"
            defaultValue={location.contactPhone ?? ""}
            error={errors.contactPhone}
            hint="Formatted for humans — e.g. (832) 228-5929."
          />
          <Field
            label="Phone (E.164)"
            name="contactPhoneE164"
            defaultValue={location.contactPhoneE164 ?? ""}
            error={errors.contactPhoneE164}
            hint="For tel: links and Twilio — e.g. +18322285929."
          />
        </div>
        <Field
          label="Support email"
          name="contactSupportEmail"
          defaultValue={location.contactSupportEmail ?? ""}
          error={errors.contactSupportEmail}
          hint="Customer-facing inbox; reply-to default for marketing email."
        />
      </Section>

      <Section
        title="Marketing identity"
        description="Sender details for email + SMS campaigns. The subdomain must be verified on Resend (tracked in Setup)."
      >
        <Field
          label="From name"
          name="marketingFromName"
          defaultValue={location.marketingFromName ?? ""}
          error={errors.marketingFromName}
          hint="Human name reads better — e.g. 'Matt from H-Town'."
        />
        <Field
          label="Sending subdomain"
          name="marketingSendingSubdomain"
          defaultValue={location.marketingSendingSubdomain ?? ""}
          error={errors.marketingSendingSubdomain}
          hint="The marketing-only subdomain — e.g. send.htownatvrentals.org."
        />
        <Field
          label="Reply-to email"
          name="marketingReplyToEmail"
          defaultValue={location.marketingReplyToEmail ?? ""}
          error={errors.marketingReplyToEmail}
          hint="Typically on the root domain, monitored by ops/VA."
        />
      </Section>

      <Section
        title="Social handles"
        description="Full URLs to the location's social profiles. Optional."
      >
        <Field
          label="Instagram"
          name="socialsInstagram"
          defaultValue={location.socialsInstagram ?? ""}
          error={errors.socialsInstagram}
          placeholder="https://www.instagram.com/…"
          optional
        />
        <Field
          label="TikTok"
          name="socialsTiktok"
          defaultValue={location.socialsTiktok ?? ""}
          error={errors.socialsTiktok}
          placeholder="https://www.tiktok.com/@…"
          optional
        />
        <Field
          label="Facebook"
          name="socialsFacebook"
          defaultValue={location.socialsFacebook ?? ""}
          error={errors.socialsFacebook}
          placeholder="https://www.facebook.com/…"
          optional
        />
      </Section>

      <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-3 border-t border-zinc-200 bg-white/80 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
        <SavedIndicator saved={state.ok} />
        <SubmitButton />
      </div>
    </form>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid grid-cols-1 gap-6 md:grid-cols-3">
      <header className="md:col-span-1">
        <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          {title}
        </h2>
        <p className="mt-1 text-sm text-zinc-500">{description}</p>
      </header>
      <div className="space-y-4 md:col-span-2">{children}</div>
    </section>
  );
}

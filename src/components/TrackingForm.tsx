"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Field } from "@/components/Field";
import {
  updateTracking,
  verifyTracking,
  type UpdateTrackingState,
} from "@/lib/actions/tracking";
import type {
  Location,
  TrackingConfig,
  VerificationResult,
} from "@/lib/db/schema";

type Props = {
  location: Location;
  config: TrackingConfig | null;
};

const INITIAL_STATE = { ok: false as const, errors: {} as Record<string, string> };

type Mode = "direct" | "gtm_only" | "hybrid";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
    >
      {pending ? "Saving…" : "Save tracking config"}
    </button>
  );
}

export function TrackingForm({ location, config }: Props) {
  // No FareHarbor shortname → this location runs on the custom booking system,
  // so it IS the canonical Purchase source (CAPI toggle should be ON).
  const isCustomBooking = !location.fareharborShortname;
  const [mode, setMode] = useState<Mode>(config?.mode ?? "direct");
  const [capiEnabled, setCapiEnabled] = useState(
    config?.metaCapiPurchaseEnabled ?? false,
  );
  const [verifying, startVerify] = useTransition();

  const boundUpdate = updateTracking.bind(null, location.slug);
  const [state, formAction] = useActionState<UpdateTrackingState, FormData>(
    boundUpdate,
    INITIAL_STATE,
  );
  const errors = "errors" in state ? state.errors : {};

  const verification = config?.verificationResults ?? {};

  return (
    <form action={formAction} className="space-y-8">
      {/* Mode selector */}
      <div>
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Mode
        </label>
        <p className="mt-1 text-xs text-zinc-500">
          Choose how this location runs tracking. Most locations use Direct.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {(
            [
              {
                value: "direct",
                label: "Direct",
                hint: "Site loads Meta pixel + GA4 + Ads scripts itself.",
              },
              {
                value: "gtm_only",
                label: "GTM only",
                hint: "Site loads only GTM. Client manages all tags inside GTM.",
              },
              {
                value: "hybrid",
                label: "Hybrid",
                hint: "GTM plus direct tags. Advanced setups only.",
              },
            ] as const
          ).map((option) => (
            <label
              key={option.value}
              className={`cursor-pointer rounded-md border p-3 transition-colors ${
                mode === option.value
                  ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/50"
                  : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600"
              }`}
            >
              <input
                type="radio"
                name="mode"
                value={option.value}
                checked={mode === option.value}
                onChange={() => setMode(option.value)}
                className="sr-only"
              />
              <div className="text-sm font-medium">{option.label}</div>
              <div className="mt-1 text-xs text-zinc-500">{option.hint}</div>
            </label>
          ))}
        </div>
      </div>

      {/* Direct + hybrid fields */}
      {mode !== "gtm_only" && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Direct tag IDs
          </h3>
          <TrackingField
            label="Meta pixel ID"
            name="metaPixelId"
            defaultValue={config?.metaPixelId ?? ""}
            error={errors.metaPixelId}
            verification={verification.metaPixelId}
            hint="15–17 digits, no prefix. From Meta Events Manager → Data Sources (the Pixel / Dataset ID)."
            placeholder="516637097197570"
          />
          <TrackingField
            label="Meta domain verification token"
            name="metaDomainVerification"
            defaultValue={config?.metaDomainVerification ?? ""}
            error={errors.metaDomainVerification}
            hint="The alphanumeric verification string from Meta Business Manager → Brand Safety → Domains."
            placeholder="z5w8q…"
          />
          <TrackingField
            label="GA4 measurement ID"
            name="ga4MeasurementId"
            defaultValue={config?.ga4MeasurementId ?? ""}
            error={errors.ga4MeasurementId}
            verification={verification.ga4MeasurementId}
            hint="Starts with G-. From GA4 → Admin → Data Streams."
            placeholder="G-ABCDEF1234"
          />
          <TrackingField
            label="Google Ads conversion ID"
            name="googleAdsConversionId"
            defaultValue={config?.googleAdsConversionId ?? ""}
            error={errors.googleAdsConversionId}
            verification={verification.googleAdsConversionId}
            hint="Starts with AW-. From Google Ads → Tools → Conversions."
            placeholder="AW-12345678"
          />
          <TrackingField
            label="Google Ads purchase label"
            name="googleAdsPurchaseLabel"
            defaultValue={config?.googleAdsPurchaseLabel ?? ""}
            error={errors.googleAdsPurchaseLabel}
            verification={verification.googleAdsPurchaseLabel}
            hint="The part after the slash in the conversion's send_to. Required with the ID above — without both, no Ads conversion is sent when a booking completes."
            placeholder="AbC-D_efGhIjKlMnOp"
          />
        </div>
      )}

      {/* GTM + hybrid fields */}
      {mode !== "direct" && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Google Tag Manager
          </h3>
          <TrackingField
            label="GTM container ID"
            name="gtmContainerId"
            defaultValue={config?.gtmContainerId ?? ""}
            error={errors.gtmContainerId}
            verification={verification.gtmContainerId}
            hint="Starts with GTM-. From Tag Manager → workspace top-bar."
            placeholder="GTM-ABC1234"
          />
          <Field
            label="Server-side GTM endpoint"
            name="serverSideGtmEndpoint"
            defaultValue={config?.serverSideGtmEndpoint ?? ""}
            error={errors.serverSideGtmEndpoint}
            hint="Optional. Only if this client runs sGTM."
            placeholder="https://sgtm.example.com"
            optional
          />
        </div>
      )}

      {/* GTM-only mode also keeps GTM as an optional field in direct mode */}
      {mode === "direct" && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Optional: GTM container
          </h3>
          <Field
            label="GTM container ID"
            name="gtmContainerId"
            defaultValue={config?.gtmContainerId ?? ""}
            error={errors.gtmContainerId}
            hint="Set only if this client also runs a GTM container alongside the direct tags."
            placeholder="GTM-ABC1234"
            optional
          />
        </div>
      )}

      {/* Meta CAPI Purchase toggle — guidance depends on booking mode. */}
      <div
        className={
          isCustomBooking
            ? "rounded-md border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/40"
            : "rounded-md border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/50"
        }
      >
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="metaCapiPurchaseEnabled"
            checked={capiEnabled}
            onChange={(e) => setCapiEnabled(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
          />
          <div className="flex-1 text-sm">
            <div
              className={
                isCustomBooking
                  ? "font-medium text-blue-900 dark:text-blue-100"
                  : "font-medium text-amber-900 dark:text-amber-100"
              }
            >
              Enable our Meta CAPI Purchase events
            </div>
            {isCustomBooking ? (
              <div className="mt-1 text-xs text-blue-800 dark:text-blue-300">
                This location runs on the custom booking system (no FareHarbor),
                so <strong>we are the canonical source of Purchase events</strong>
                . Keep this <strong>ON</strong> — the booking app fires the
                server-side Purchase (deduped with the client pixel). If it&apos;s
                off, no server-side Purchase is sent.
              </div>
            ) : (
              <div className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                FareHarbor&apos;s own CAPI integration is canonical for Purchase
                and is normally the only source firing. Turn this on only if you
                know FareHarbor&apos;s CAPI is down or you&apos;re running a
                controlled comparison. Both on at the same time =
                double-counting.
              </div>
            )}
          </div>
        </label>
      </div>

      {/* Action bar */}
      <div className="sticky bottom-0 -mx-4 flex items-center justify-between gap-3 border-t border-zinc-200 bg-white/80 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
        <button
          type="button"
          onClick={() => {
            startVerify(() => {
              void verifyTracking(location.slug);
            });
          }}
          disabled={verifying || !location.domainCanonical}
          title={
            location.domainCanonical
              ? "Fetch the live site and check that each ID is actually present"
              : "Set domain.canonical on this location first"
          }
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          {verifying ? "Verifying…" : "Verify on live site"}
        </button>
        <div className="flex items-center gap-3">
          {state.ok && (
            <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
              ✓ Saved
            </span>
          )}
          <SaveButton />
        </div>
      </div>
    </form>
  );
}

type TrackingFieldProps = {
  label: string;
  name: string;
  defaultValue: string;
  error?: string;
  verification?: VerificationResult;
  hint?: string;
  placeholder?: string;
};

// Tracking-specific field — same Field component but adds a verification
// status pill when results exist from the last live-site check.
function TrackingField({
  label,
  name,
  defaultValue,
  error,
  verification,
  hint,
  placeholder,
}: TrackingFieldProps) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label
          htmlFor={`tf-${name}`}
          className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          {label}
        </label>
        {verification && <VerifyPill result={verification} />}
      </div>
      <input
        type="text"
        id={`tf-${name}`}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className={`mt-1.5 block w-full rounded-md border bg-white px-3 py-2 font-mono text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-zinc-900 ${
          error
            ? "border-red-400 dark:border-red-500"
            : "border-zinc-300 dark:border-zinc-700"
        }`}
      />
      {error ? (
        <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-zinc-500">{hint}</p>
      ) : null}
    </div>
  );
}

function VerifyPill({ result }: { result: VerificationResult }) {
  const styles: Record<VerificationResult["status"], { label: string; cls: string }> = {
    match: {
      label: "✓ Live on site",
      cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200",
    },
    mismatch: {
      label: `≠ Found ${result.foundValue ?? "different value"}`,
      cls: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200",
    },
    not_found: {
      label: "✗ Not on site",
      cls: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-200",
    },
    fetch_failed: {
      label: "? Site unreachable",
      cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
    },
  };
  const s = styles[result.status];
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${s.cls}`}>
      {s.label}
    </span>
  );
}

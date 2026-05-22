"use client";

import Image from "next/image";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  saveVisualIdentity,
  type SaveVisualIdentityState,
  uploadLogo,
  type UploadLogoState,
  type ExtractedSwatch,
} from "@/lib/actions/visual-identity";
import {
  BODY_FONTS,
  DISPLAY_FONTS,
  TAKEOVERS_DEFAULT_BODY,
  TAKEOVERS_DEFAULT_DISPLAY,
} from "@/lib/fonts";
import type { Location } from "@/lib/db/schema";

type Props = {
  location: Location;
};

const INITIAL_UPLOAD = { ok: false as const, error: "" };
const INITIAL_SAVE = { ok: false as const, errors: {} as Record<string, string> };

function UploadButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
    >
      {pending ? "Uploading + extracting…" : "Upload logo"}
    </button>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
    >
      {pending ? "Saving…" : "Save visual identity"}
    </button>
  );
}

export function VisualIdentityForm({ location }: Props) {
  // Upload form state (logo file → blob URL + vibrant swatches)
  const boundUpload = uploadLogo.bind(null, location.slug);
  const [uploadState, uploadFormAction] = useActionState<UploadLogoState, FormData>(
    boundUpload,
    INITIAL_UPLOAD,
  );

  // Save form state (colors + fonts → DB)
  const boundSave = saveVisualIdentity.bind(null, location.slug);
  const [saveState, saveFormAction] = useActionState<SaveVisualIdentityState, FormData>(
    boundSave,
    INITIAL_SAVE,
  );

  // Logo URL: prefer the latest upload result; fall back to whatever's
  // already persisted on the location row.
  const logoUrl = uploadState.ok
    ? uploadState.logoUrl
    : location.visualLogoUrl ?? null;

  const swatches: ExtractedSwatch[] = uploadState.ok ? uploadState.swatches : [];

  // Color / font picks are client-controlled so the operator can iterate
  // before committing. Defaults to the location's current values.
  const [primaryColor, setPrimaryColor] = useState(
    location.visualPrimaryColor ?? "",
  );
  const [accentColor, setAccentColor] = useState(
    location.visualAccentColor ?? "",
  );
  const [displayFont, setDisplayFont] = useState(
    location.visualDisplayFont ?? TAKEOVERS_DEFAULT_DISPLAY,
  );
  const [bodyFont, setBodyFont] = useState(
    location.visualBodyFont ?? TAKEOVERS_DEFAULT_BODY,
  );

  const saveErrors = "errors" in saveState ? saveState.errors : {};

  return (
    <div className="space-y-8">
      {/* Logo upload — independent form. Posts the file, gets back blob URL +
          extracted palette. Errors render inline. */}
      <form action={uploadFormAction} className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="file"
            name="logo"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="block w-full max-w-md text-sm text-zinc-500 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-zinc-800 dark:file:bg-zinc-100 dark:file:text-zinc-900 dark:hover:file:bg-zinc-200"
          />
          <UploadButton />
        </div>
        {!uploadState.ok && uploadState.error && (
          <p className="text-sm font-medium text-red-600 dark:text-red-400">
            {uploadState.error}
          </p>
        )}
      </form>

      {/* Preview + extracted palette */}
      {logoUrl && (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex h-24 w-24 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900">
              <Image
                src={logoUrl}
                alt="Current logo"
                width={96}
                height={96}
                className="max-h-full max-w-full object-contain"
                unoptimized
              />
            </div>
            <p className="text-xs text-zinc-500">
              Current logo. Upload a new file above to replace it.
            </p>
          </div>

          {swatches.length > 0 && (
            <div className="rounded-md border border-zinc-200 bg-zinc-50/50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
              <p className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500">
                Colors extracted from your logo
              </p>
              <div className="flex flex-wrap gap-3">
                {swatches.map((s) => (
                  <SwatchCard
                    key={s.name}
                    swatch={s}
                    onUseAsPrimary={() => setPrimaryColor(s.hex)}
                    onUseAsAccent={() => setAccentColor(s.hex)}
                  />
                ))}
              </div>
            </div>
          )}

          {uploadState.ok && swatches.length === 0 && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
              Couldn&apos;t extract a meaningful palette from this logo
              (monochrome or SVG). Enter brand colors manually below.
            </p>
          )}
        </div>
      )}

      {/* Colors + fonts save form */}
      <form action={saveFormAction} className="space-y-6">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <ColorSlot
            label="Primary color"
            name="primaryColor"
            value={primaryColor}
            onChange={setPrimaryColor}
            error={saveErrors.primaryColor}
            hint="Used for buttons, links, the brand accent throughout the site."
          />
          <ColorSlot
            label="Accent color"
            name="accentColor"
            value={accentColor}
            onChange={setAccentColor}
            error={saveErrors.accentColor}
            hint="Secondary color — used for highlights, hover states, badges."
          />
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <FontSlot
            label="Display font"
            name="displayFont"
            value={displayFont}
            onChange={setDisplayFont}
            options={DISPLAY_FONTS}
          />
          <FontSlot
            label="Body font"
            name="bodyFont"
            value={bodyFont}
            onChange={setBodyFont}
            options={BODY_FONTS}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              setDisplayFont(TAKEOVERS_DEFAULT_DISPLAY);
              setBodyFont(TAKEOVERS_DEFAULT_BODY);
            }}
            className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
          >
            ← Use Takeovers default fonts
          </button>
          <div className="flex items-center gap-3">
            {saveState.ok && (
              <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                ✓ Saved
              </span>
            )}
            <SaveButton />
          </div>
        </div>
      </form>
    </div>
  );
}

function SwatchCard({
  swatch,
  onUseAsPrimary,
  onUseAsAccent,
}: {
  swatch: ExtractedSwatch;
  onUseAsPrimary: () => void;
  onUseAsAccent: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className="h-12 w-12 rounded-md ring-1 ring-zinc-200 dark:ring-zinc-700"
        style={{ backgroundColor: swatch.hex }}
      />
      <code className="font-mono text-xs text-zinc-600 dark:text-zinc-400">
        {swatch.hex}
      </code>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={onUseAsPrimary}
          className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          → Primary
        </button>
        <button
          type="button"
          onClick={onUseAsAccent}
          className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          → Accent
        </button>
      </div>
    </div>
  );
}

function ColorSlot({
  label,
  name,
  value,
  onChange,
  error,
  hint,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </label>
      <div className="mt-1.5 flex items-center gap-2">
        <input
          type="color"
          value={value || "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-9 cursor-pointer rounded-md border border-zinc-300 bg-white p-1 dark:border-zinc-700 dark:bg-zinc-900"
          aria-label={`${label} color picker`}
        />
        <input
          type="text"
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#c8102e"
          className={`block w-full rounded-md border bg-white px-3 py-2 font-mono text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-zinc-900 ${
            error
              ? "border-red-400 dark:border-red-500"
              : "border-zinc-300 dark:border-zinc-700"
          }`}
        />
      </div>
      {error ? (
        <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : (
        <p className="mt-1 text-xs text-zinc-500">{hint}</p>
      )}
    </div>
  );
}

function FontSlot({
  label,
  name,
  value,
  onChange,
  options,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  options: { family: string; hint: string }[];
}) {
  const current = options.find((o) => o.family === value);
  return (
    <div>
      <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </label>
      <select
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
      >
        {options.map((o) => (
          <option key={o.family} value={o.family}>
            {o.family}
          </option>
        ))}
      </select>
      <div
        className="mt-2 rounded-md border border-zinc-200 bg-zinc-50/50 p-3 dark:border-zinc-800 dark:bg-zinc-900/50"
        style={{ fontFamily: `'${value}', sans-serif` }}
      >
        <p className="text-lg leading-tight">The quick brown fox</p>
        <p className="text-xs text-zinc-500">jumps over the lazy dog.</p>
      </div>
      {current && (
        <p className="mt-1 text-xs text-zinc-500">{current.hint}</p>
      )}
    </div>
  );
}

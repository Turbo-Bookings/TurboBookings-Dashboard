"use client";

import Image from "next/image";
import { useActionState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import {
  deleteAsset,
  reorderGallery,
  uploadAsset,
  type UploadAssetState,
} from "@/lib/actions/media";
import type { Asset, Location } from "@/lib/db/schema";

type Props = {
  location: Location;
  assetsByKind: Record<Asset["kind"], Asset[]>;
};

const INITIAL_UPLOAD = { ok: false as const, error: "" };

export function MediaForm({ location, assetsByKind }: Props) {
  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <header>
          <h3 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Hero videos
          </h3>
          <p className="mt-1 text-xs text-zinc-500">
            Loop on the home page hero. Recommended encoding:{" "}
            <code className="font-mono">
              ffmpeg -vf scale=1280:720 -c:v libx264 -preset slower -crf 30
              -pix_fmt yuv420p -an -movflags +faststart
            </code>{" "}
            (auto-re-encode coming in Phase 1.4 — for now please pre-encode
            before upload to keep files under ~3 MB).
          </p>
        </header>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <SingularUploader
            slug={location.slug}
            kind="hero_desktop"
            current={assetsByKind.hero_desktop[0]}
            label="Desktop (16:9)"
            accept="video/mp4,video/quicktime,video/webm"
          />
          <SingularUploader
            slug={location.slug}
            kind="hero_mobile"
            current={assetsByKind.hero_mobile[0]}
            label="Mobile (9:16)"
            accept="video/mp4,video/quicktime,video/webm"
          />
        </div>
      </section>

      <section className="space-y-4">
        <header>
          <h3 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Open Graph image
          </h3>
          <p className="mt-1 text-xs text-zinc-500">
            Shown when the marketing site is shared on Facebook, iMessage, Slack,
            etc. Recommended: 1200×630 JPEG, ≤500 KB, primary subject centered
            so the platforms&apos; auto-crops don&apos;t cut it off.
          </p>
        </header>
        <SingularUploader
          slug={location.slug}
          kind="og_image"
          current={assetsByKind.og_image[0]}
          label="OG image"
          accept="image/jpeg,image/png,image/webp"
        />
      </section>

      <section className="space-y-4">
        <header>
          <h3 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Gallery photos
          </h3>
          <p className="mt-1 text-xs text-zinc-500">
            Rendered in the marketing site&apos;s photo gallery. Order them with
            ↑/↓ — the first photo is most prominent. Recommended: 8-12 photos,
            JPEG, max 1920px wide, ≤500 KB each.
          </p>
        </header>

        <GalleryGrid slug={location.slug} photos={assetsByKind.gallery_photo} />

        <UploadForm
          slug={location.slug}
          kind="gallery_photo"
          label="Add photo"
          accept="image/jpeg,image/png,image/webp"
        />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Singular kinds (hero_desktop, hero_mobile, og_image): show current asset
// preview if one exists, plus an upload form that replaces it on submit.
// ---------------------------------------------------------------------------

type SingularUploaderProps = {
  slug: string;
  kind: Asset["kind"];
  current: Asset | undefined;
  label: string;
  accept: string;
};

function SingularUploader({
  slug,
  kind,
  current,
  label,
  accept,
}: SingularUploaderProps) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </p>
      {current ? (
        <div className="mt-2">
          <AssetPreview asset={current} />
          <p className="mt-1 text-[10px] text-zinc-400">
            {formatBytes(current.sizeBytes)}
          </p>
        </div>
      ) : (
        <div className="mt-2 flex h-24 items-center justify-center rounded-md border border-dashed border-zinc-200 bg-zinc-50/50 text-xs text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900/50">
          Not uploaded yet
        </div>
      )}
      <div className="mt-3">
        <UploadForm slug={slug} kind={kind} label={current ? "Replace" : "Upload"} accept={accept} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generic upload form — file input + submit. Used by all four kinds.
// ---------------------------------------------------------------------------

function SubmitUploadButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
    >
      {pending ? "Uploading…" : label}
    </button>
  );
}

function UploadForm({
  slug,
  kind,
  label,
  accept,
}: {
  slug: string;
  kind: Asset["kind"];
  label: string;
  accept: string;
}) {
  const bound = uploadAsset.bind(null, slug, kind);
  const [state, action] = useActionState<UploadAssetState, FormData>(
    bound,
    INITIAL_UPLOAD,
  );

  return (
    <form action={action} className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="file"
          name="file"
          accept={accept}
          required
          className="block w-full text-xs text-zinc-500 file:mr-2 file:rounded-md file:border-0 file:bg-zinc-100 file:px-2 file:py-1.5 file:text-xs file:font-medium file:text-zinc-900 hover:file:bg-zinc-200 dark:file:bg-zinc-800 dark:file:text-zinc-100 dark:hover:file:bg-zinc-700"
        />
        <SubmitUploadButton label={label} />
      </div>
      {!state.ok && state.error && (
        <p className="text-xs font-medium text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Gallery: grid of thumbnails with ↑/↓ reorder + delete per item. Drag-and-
// drop is a later polish — buttons are accessible and good enough for 8-12
// items.
// ---------------------------------------------------------------------------

function GalleryGrid({
  slug,
  photos,
}: {
  slug: string;
  photos: Asset[];
}) {
  const [pending, startTransition] = useTransition();

  function move(idx: number, direction: -1 | 1) {
    const target = idx + direction;
    if (target < 0 || target >= photos.length) return;
    const reordered = [...photos];
    [reordered[idx], reordered[target]] = [reordered[target], reordered[idx]];
    startTransition(() => {
      void reorderGallery(slug, reordered.map((p) => p.id));
    });
  }

  function remove(id: string) {
    if (!confirm("Remove this photo?")) return;
    startTransition(() => {
      void deleteAsset(slug, id);
    });
  }

  if (photos.length === 0) {
    return (
      <div className="rounded-md border-2 border-dashed border-zinc-200 bg-zinc-50/50 p-6 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/30">
        No gallery photos yet.
      </div>
    );
  }

  return (
    <div
      className={`grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 ${pending ? "opacity-60" : ""}`}
    >
      {photos.map((photo, idx) => (
        <div
          key={photo.id}
          className="group relative overflow-hidden rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="relative aspect-square w-full">
            <Image
              src={photo.blobUrl}
              alt={`Gallery photo ${idx + 1}`}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 50vw, 25vw"
              unoptimized
            />
          </div>
          <div className="flex items-center justify-between gap-1 border-t border-zinc-200 bg-white p-1.5 dark:border-zinc-800 dark:bg-zinc-900">
            <span className="px-1 text-[10px] font-mono text-zinc-500">
              {idx + 1}
            </span>
            <div className="flex gap-0.5">
              <button
                type="button"
                onClick={() => move(idx, -1)}
                disabled={idx === 0 || pending}
                aria-label="Move up"
                className="rounded px-1.5 text-xs text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(idx, 1)}
                disabled={idx === photos.length - 1 || pending}
                aria-label="Move down"
                className="rounded px-1.5 text-xs text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => remove(photo.id)}
                disabled={pending}
                aria-label="Remove photo"
                className="rounded px-1.5 text-xs text-zinc-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-30 dark:hover:bg-red-950 dark:hover:text-red-400"
              >
                ×
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Asset preview — image or video depending on the asset's content type.
// ---------------------------------------------------------------------------

function AssetPreview({ asset }: { asset: Asset }) {
  if (asset.contentType.startsWith("video/")) {
    return (
      <video
        src={asset.blobUrl}
        controls
        playsInline
        className="aspect-video w-full rounded-md bg-black object-contain"
      />
    );
  }
  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-md bg-zinc-50 dark:bg-zinc-900">
      <Image
        src={asset.blobUrl}
        alt="Asset preview"
        fill
        className="object-contain"
        unoptimized
      />
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

"use client";

import Image from "next/image";
import { useActionState, useState, useTransition } from "react";
import { ImagePlus, Star, X } from "lucide-react";
import {
  removeItemPhoto,
  setItemCoverPhoto,
  uploadItemPhoto,
  type ItemPhotoState,
} from "@/lib/actions/itemPhotos";

export function ItemPhotoManager({
  slug,
  itemId,
  photos,
}: {
  slug: string;
  itemId: string;
  photos: string[];
}) {
  const upload = uploadItemPhoto.bind(null, slug, itemId);
  const [state, formAction, uploading] = useActionState<ItemPhotoState | null, FormData>(
    upload,
    null,
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function act(fn: () => Promise<ItemPhotoState>) {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error);
    });
  }

  const busy = uploading || pending;
  const uploadError = state && !state.ok ? state.error : null;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Photos</h2>
        <p className="text-xs text-zinc-500">
          Shown on the customer tour page. The first photo (★) is the cover. JPEG/PNG/WebP, up to 5 MB each.
        </p>
      </div>

      {photos.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {photos.map((url, i) => (
            <div key={url} className="group relative aspect-[4/3] overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-800">
              <Image src={url} alt="" fill sizes="200px" className="object-cover" />
              {i === 0 && (
                <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> Cover
                </span>
              )}
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/70 to-transparent p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                {i !== 0 ? (
                  <button type="button" disabled={busy} onClick={() => act(() => setItemCoverPhoto(slug, itemId, url))} className="rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-medium text-zinc-800 hover:bg-white disabled:opacity-50">
                    Make cover
                  </button>
                ) : <span />}
                <button type="button" disabled={busy} onClick={() => act(() => removeItemPhoto(slug, itemId, url))} className="rounded bg-white/90 p-1 text-zinc-700 hover:bg-white hover:text-red-600 disabled:opacity-50" aria-label="Remove photo">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <form action={formAction} className="flex items-center gap-3">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
          <ImagePlus className="h-4 w-4" />
          Add photo
          <input
            type="file"
            name="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              if (e.target.form && e.target.files?.length) e.target.form.requestSubmit();
            }}
          />
        </label>
        {uploading && <span className="text-xs text-zinc-500">Uploading…</span>}
      </form>

      {(uploadError || error) && (
        <p className="text-xs font-medium text-red-600 dark:text-red-400">{uploadError ?? error}</p>
      )}
    </section>
  );
}

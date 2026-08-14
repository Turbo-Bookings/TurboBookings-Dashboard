import "server-only";
import sharp from "sharp";

// Server-side image optimization for uploaded brand assets. Resizes down to a
// sane ceiling and recompresses — WITHOUT changing the format/extension, so the
// marketing template's fixed asset filenames keep working. This is the first
// line of defense against the Vercel bandwidth blowup (a $166 bill from a 27MB
// hero video / unoptimized images). Hero VIDEOS can't be transcoded in a
// serverless action (no ffmpeg) — those are size-guarded at upload and
// transcoded in the fork/CI step.

export type OptimizeOpts = {
  maxWidth: number;
  maxHeight: number;
  quality?: number; // 1-100, default 80
};

export type OptimizedImage = {
  buffer: Buffer;
  contentType: string;
  bytes: number;
};

const FORMAT_BY_MIME: Record<string, "jpeg" | "png" | "webp"> = {
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
};

// Returns the optimized buffer, or null if the type isn't a raster image we
// optimize (e.g. SVG — vector, already tiny). Never throws for a bad image:
// callers fall back to the original on null.
export async function optimizeImage(
  input: Buffer,
  mime: string,
  opts: OptimizeOpts,
): Promise<OptimizedImage | null> {
  const format = FORMAT_BY_MIME[mime];
  if (!format) return null; // svg / unknown → leave as-is
  const q = opts.quality ?? 80;
  try {
    let pipeline = sharp(input, { failOn: "none" })
      .rotate() // honor EXIF orientation, then strip metadata
      .resize({
        width: opts.maxWidth,
        height: opts.maxHeight,
        fit: "inside",
        withoutEnlargement: true,
      });

    if (format === "jpeg") {
      pipeline = pipeline.jpeg({ quality: q, mozjpeg: true });
    } else if (format === "png") {
      pipeline = pipeline.png({ compressionLevel: 9, palette: true });
    } else {
      pipeline = pipeline.webp({ quality: q });
    }

    const buffer = await pipeline.toBuffer();
    return { buffer, contentType: mime, bytes: buffer.length };
  } catch (err) {
    console.error("image optimization failed — using original", err);
    return null;
  }
}

// Per-asset-kind ceilings. Dimensions are generous enough to look sharp on
// large screens while keeping bytes down.
export const IMAGE_PRESETS = {
  og_image: { maxWidth: 1200, maxHeight: 1200, quality: 82 },
  gallery_photo: { maxWidth: 1920, maxHeight: 1920, quality: 80 },
  tour_photo: { maxWidth: 1600, maxHeight: 1600, quality: 80 },
  logo: { maxWidth: 800, maxHeight: 800, quality: 90 },
} as const;

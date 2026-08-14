// Fork CLI — produces a working location repo from a fully-filled location
// row in the admin DB.
//
// Usage:
//   npm run fork -- <slug>           # build the repo locally
//   npm run fork -- <slug> --push    # build + push to GitHub
//
// Steps performed:
//   1. Read the location row from Neon, validate required fields
//   2. Mark status = building
//   3. Clone takeovers-site main (the template) to ../<slug>-atv-rentals-site
//   4. Generate src/config/site.ts from the row
//   5. Update package.json name + README
//   6. Download assets from Vercel Blob → /public/images/<conventional-name>
//   7. Replace remaining brand strings in the template
//   8. git init + initial commit
//   9. With --push: create GitHub repo under Turbo-Bookings org + push
//  10. Print operator follow-up checklist (Vercel project, env vars, DNS)
//
// Auto-Vercel-provisioning (project + Edge Config + env vars) lands when
// VERCEL_API_TOKEN is configured. Without it the CLI stops at step 9 with
// a clear "now do these manually" surface.

import { spawn, type SpawnOptions } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { eq, sql } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import { assets, items, locations } from "../src/lib/db/schema";
import type {
  Asset,
  Item,
  Location,
  TourCatalogItem,
} from "../src/lib/db/schema";

const TEMPLATE_REPO = "https://github.com/Turbo-Bookings/takeovers-site.git";
const GITHUB_ORG = "Turbo-Bookings";

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const slug = args.find((a) => !a.startsWith("--"));
  const push = args.includes("--push");
  // Custom-booking locations (e.g. Dallas) run on the custom booking system via
  // a /book/* rewrite instead of FareHarbor, so they don't have FareHarbor
  // account fields. Skip the FareHarbor validation + print the /book follow-ups.
  const customBooking = args.includes("--custom-booking");
  // Re-sync assets into an already-forked repo (no clone / site.ts / git init).
  // Use after uploading/replacing assets in the dashboard's Branding & Tours tab.
  const assetsOnly = args.includes("--assets-only");

  if (!slug) {
    fail("Usage: npm run fork -- <slug> [--custom-booking] [--assets-only] [--push]");
  }

  const url = process.env.DATABASE_URL;
  if (!url) fail("DATABASE_URL is not set. Run from a shell with .env.local loaded.");

  const db = drizzle(neon(url!));

  const locRows = await db
    .select()
    .from(locations)
    .where(eq(locations.slug, slug!))
    .limit(1);
  const loc = locRows[0];
  if (!loc) fail(`Location not found: ${slug}`);

  if (!assetsOnly) validateLocation(loc!, { customBooking });

  const assetRows = await db
    .select()
    .from(assets)
    .where(eq(assets.locationId, loc!.id));
  const groupedAssets = groupAssetsByKind(assetRows);
  const itemRows = await db
    .select()
    .from(items)
    .where(eq(items.locationId, loc!.id));

  const targetDir = resolve(scriptDir(), "..", "..", `${slug}-atv-rentals-site`);

  // ---- Assets-only re-sync path -------------------------------------------
  if (assetsOnly) {
    if (!existsSync(targetDir)) {
      fail(`Repo not found: ${targetDir}. Run a full fork first (without --assets-only).`);
    }
    log(`Re-syncing assets → ${targetDir}\n`);
    await downloadAllAssets(targetDir, groupedAssets, loc!, itemRows);
    log("✓ Assets re-synced under /public/images/\n");
    if (push) {
      await run("git", ["add", "public/images"], { cwd: targetDir });
      await run("git", ["commit", "-m", "Re-sync brand assets from dashboard"], {
        cwd: targetDir,
      });
      log("✓ Committed. Push manually or let Vercel deploy from your branch.\n");
    } else {
      log("· Review the changes, then commit + push (or re-run with --push).\n");
    }
    return;
  }

  if (existsSync(targetDir)) {
    fail(`Target directory already exists: ${targetDir}`);
  }

  log(`Forking → ${targetDir}\n`);

  // 2. Mark status = building
  await db
    .update(locations)
    .set({ status: "building", updatedAt: sql`now()` })
    .where(eq(locations.id, loc!.id));
  log("✓ Marked status = building\n");

  // 3. Clone template
  log("→ Cloning template repo…\n");
  await run("git", ["clone", "--depth=1", TEMPLATE_REPO, targetDir]);
  await run("rm", ["-rf", `${targetDir}/.git`]);
  log("✓ Template cloned\n");

  // 4. Write src/config/site.ts
  writeSiteConfig(targetDir, loc!);
  log("✓ Generated src/config/site.ts\n");

  // 5. Update package.json + README
  patchPackageJson(targetDir, slug!);
  writeReadme(targetDir, loc!);
  log("✓ Updated package.json + README\n");

  // 6. Download assets (hero/og/gallery + logo + tour photos)
  log("→ Downloading assets from Vercel Blob…\n");
  await downloadAllAssets(targetDir, groupedAssets, loc!, itemRows);
  log("✓ Assets in place under /public/images/\n");

  // 6b. Custom-booking transform — convert the FareHarbor template clone into a
  //     /book-rewrite site (see applyCustomBookingTransform).
  if (customBooking) {
    log("→ Applying custom-booking transform (/book rewrite, CTA repoint)…\n");
    applyCustomBookingTransform(targetDir, slug!);
    log("✓ Site wired to the custom booking system\n");
  }

  // 7. (Phase 2 polish) Remove Miami-specific SEO pages, drop ES locale if
  //    only en, strip Miami-specific docs. Skipped here — operator deletes
  //    these manually for now in their first review pass. A clear follow-up
  //    line item is printed below.

  // 8. git init + initial commit
  log("→ Creating initial commit…\n");
  await run("git", ["init", "--initial-branch=main"], { cwd: targetDir });
  await run("git", ["add", "-A"], { cwd: targetDir });
  await run(
    "git",
    [
      "commit",
      "-m",
      `Initial fork from Turbo-Bookings/takeovers-site for ${loc!.brandDisplayName ?? slug}`,
    ],
    { cwd: targetDir },
  );
  log("✓ Initial commit created\n");

  // 9. Push to GitHub if requested
  let repoUrl: string | null = null;
  if (push) {
    log("→ Creating GitHub repo + pushing…\n");
    repoUrl = await createGithubRepoAndPush(targetDir, slug!, loc!);
    log(`✓ Pushed to ${repoUrl}\n`);

    // Persist the repo URL on the location row so the Settings tab + future
    // Vercel-project provisioning can pick it up.
    await db
      .update(locations)
      .set({ githubRepoUrl: repoUrl, updatedAt: sql`now()` })
      .where(eq(locations.id, loc!.id));
  }

  // 10. Print follow-up checklist
  printFollowUps({ slug: slug!, push, repoUrl, loc: loc!, customBooking });
}

main().catch((err) => {
  console.error("\n× Fork failed:", err);
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateLocation(
  loc: Location,
  opts: { customBooking?: boolean } = {},
): void {
  const required: Array<[string, unknown]> = [
    ["brandDisplayName", loc.brandDisplayName],
    ["brandLocationLabel", loc.brandLocationLabel],
    ["brandLegalName", loc.brandLegalName],
    ["domainApex", loc.domainApex],
    ["domainCanonical", loc.domainCanonical],
  ];
  // FareHarbor fields are only required for FareHarbor-backed locations.
  if (!opts.customBooking) {
    required.push(
      ["fareharborShortname", loc.fareharborShortname],
      ["fareharborDefaultFlowId", loc.fareharborDefaultFlowId],
    );
  }
  const missing = required.filter(([, v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    fail(`Location is missing required fields: ${missing.join(", ")}`);
  }
}

// ---------------------------------------------------------------------------
// src/config/site.ts generator
// ---------------------------------------------------------------------------

function writeSiteConfig(targetDir: string, loc: Location): void {
  const tourCatalog = (loc.fareharborTourCatalog ?? []) as TourCatalogItem[];
  const itemsBlock = tourCatalog
    .map((t) => {
      const flow = t.flowOverride ? `, flow: ${JSON.stringify(t.flowOverride)}` : "";
      return `      ${t.key}: { id: ${JSON.stringify(t.fareharborItemId)}${flow} }`;
    })
    .join(",\n");

  const content = `// Per-location configuration. The single source of truth for brand, contact,
// canonical URL, FareHarbor account, social handles, and email-marketing
// identity. Fork-friendly: the only file a new location needs to overwrite to
// re-skin the site.
//
// Generated by the TurboBookings Dashboard Fork CLI from the location row in
// the admin DB. Re-run the fork to regenerate; otherwise edit by hand and
// the dashboard will stay in sync via the per-location config endpoint.

export type FareHarborItem = {
  id: string;
  flow?: string;
};

export type SiteConfig = {
  brand: {
    legalName: string;
    displayName: string;
    locationLabel: string;
  };
  contact: {
    address: string;
    phone: string;
    phoneE164: string;
    supportEmail: string;
  };
  domain: {
    canonical: string;
    apex: string;
    locales: readonly string[];
    defaultLocale: string;
  };
  fareharbor: {
    shortname: string;
    flowId: string;
    items: Record<string, FareHarborItem>;
  };
  marketing: {
    fromName: string;
    fromEmail: string;
    replyToEmail: string;
    sendingDomain: string;
  };
  socials: {
    instagram: string;
    tiktok: string;
    facebook: string;
  };
};

export const siteConfig: SiteConfig = {
  brand: {
    legalName: ${JSON.stringify(loc.brandLegalName ?? "")},
    displayName: ${JSON.stringify(loc.brandDisplayName ?? "")},
    locationLabel: ${JSON.stringify(loc.brandLocationLabel ?? "")},
  },
  contact: {
    address: ${JSON.stringify(loc.contactAddress ?? "")},
    phone: ${JSON.stringify(loc.contactPhone ?? "")},
    phoneE164: ${JSON.stringify(loc.contactPhoneE164 ?? "")},
    supportEmail: ${JSON.stringify(loc.contactSupportEmail ?? "")},
  },
  domain: {
    canonical: ${JSON.stringify(loc.domainCanonical ?? "")},
    apex: ${JSON.stringify(loc.domainApex ?? "")},
    locales: ${JSON.stringify(loc.domainLocales ?? ["en"])} as const,
    defaultLocale: ${JSON.stringify(loc.domainDefaultLocale ?? "en")},
  },
  fareharbor: {
    shortname: ${JSON.stringify(loc.fareharborShortname ?? "")},
    flowId: ${JSON.stringify(loc.fareharborDefaultFlowId ?? "")},
    items: {
${itemsBlock}
    },
  },
  marketing: {
    fromName: ${JSON.stringify(loc.marketingFromName ?? "")},
    fromEmail: ${JSON.stringify(loc.marketingFromName ? `${normalizeFromAddress(loc.marketingFromName)}@${loc.marketingSendingSubdomain ?? ""}` : "")},
    replyToEmail: ${JSON.stringify(loc.marketingReplyToEmail ?? "")},
    sendingDomain: ${JSON.stringify(loc.marketingSendingSubdomain ?? "")},
  },
  socials: {
    instagram: ${JSON.stringify(loc.socialsInstagram ?? "")},
    tiktok: ${JSON.stringify(loc.socialsTiktok ?? "")},
    facebook: ${JSON.stringify(loc.socialsFacebook ?? "")},
  },
};
`;
  writeFileSafe(`${targetDir}/src/config/site.ts`, content);
}

function normalizeFromAddress(name: string): string {
  // Turn "Matt from H-Town" → "matt" for the local-part of the from address.
  // Conventional pattern across our existing locations.
  return name.split(" ")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ---------------------------------------------------------------------------
// package.json + README
// ---------------------------------------------------------------------------

function patchPackageJson(targetDir: string, slug: string): void {
  const path = `${targetDir}/package.json`;
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  pkg.name = `${slug}-atv-rentals-site`;
  pkg.version = "0.1.0";
  writeFileSafe(path, JSON.stringify(pkg, null, 2) + "\n");
}

function writeReadme(targetDir: string, loc: Location): void {
  const content = `# ${loc.brandDisplayName ?? "ATV Rentals"} — Marketing Site

Forked from \`Turbo-Bookings/takeovers-site\` for ${loc.brandLocationLabel}.

## Live

- Domain: ${loc.domainCanonical}
- Apex: ${loc.domainApex}

## Stack

Next.js 16 App Router, identical to the takeovers-site template. Per-location
config in \`src/config/site.ts\`. Tracking IDs + secrets managed via the
TurboBookings Dashboard.

## Local development

\`\`\`bash
npm install
npm run dev
\`\`\`

Then open http://localhost:3000.
`;
  writeFileSafe(`${targetDir}/README.md`, content);
}

// ---------------------------------------------------------------------------
// Asset download
// ---------------------------------------------------------------------------

function groupAssetsByKind(rows: Asset[]): Record<Asset["kind"], Asset[]> {
  const grouped: Record<Asset["kind"], Asset[]> = {
    hero_desktop: [],
    hero_mobile: [],
    og_image: [],
    gallery_photo: [],
  };
  for (const r of rows) grouped[r.kind].push(r);
  // Gallery photos must be in sort order for deterministic numbering.
  grouped.gallery_photo.sort((a, b) => a.sortOrder - b.sortOrder);
  return grouped;
}

async function downloadAssets(
  targetDir: string,
  grouped: Record<Asset["kind"], Asset[]>,
): Promise<void> {
  const imagesDir = `${targetDir}/public/images`;
  mkdirSync(imagesDir, { recursive: true });

  // Singular kinds → conventional filenames the template references.
  await downloadOne(grouped.hero_desktop[0], `${imagesDir}/hero-desktop-v2.mp4`);
  await downloadOne(grouped.hero_mobile[0], `${imagesDir}/hero-mobile-v2.mp4`);
  await downloadOne(grouped.og_image[0], `${imagesDir}/og-image-v2.jpg`);

  // Gallery photos numbered in order. Template references gallery-1 through
  // gallery-8 — we honor that ceiling but allow fewer.
  for (let i = 0; i < Math.min(grouped.gallery_photo.length, 8); i++) {
    const asset = grouped.gallery_photo[i];
    const ext = asset.contentType.includes("png") ? "png" : "jpg";
    await downloadOne(asset, `${imagesDir}/gallery-${i + 1}.${ext}`);
  }
}

async function downloadOne(asset: Asset | undefined, destPath: string): Promise<void> {
  if (!asset) return;
  await downloadUrl(asset.blobUrl, destPath);
}

// Download a raw Blob URL (used for the logo + per-tour photos, which live on
// the location row / items rows rather than the assets table).
async function downloadUrl(
  urlStr: string | null | undefined,
  destPath: string,
): Promise<void> {
  if (!urlStr) return;
  const res = await fetch(urlStr);
  if (!res.ok) {
    log(`  ! Failed to download ${urlStr} (${res.status}) — skipping\n`);
    return;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSafe(destPath, buf);
  log(`  ✓ ${destPath.split("/").pop()} (${formatBytes(buf.length)})\n`);
}

// Full brand-asset sync: the four assets-table kinds (hero/og/gallery) plus the
// logo (locations.visualLogoUrl → logo.png) and the first photo of each tour
// (items.photoUrls → tour-1.jpg …), all placed at conventional filenames the
// template + fork transform reference. Safe to call repeatedly (--assets-only).
async function downloadAllAssets(
  targetDir: string,
  grouped: Record<Asset["kind"], Asset[]>,
  loc: Location,
  itemRows: Item[],
): Promise<void> {
  await downloadAssets(targetDir, grouped);
  const imagesDir = `${targetDir}/public/images`;
  mkdirSync(imagesDir, { recursive: true });

  // Logo — uploaded via Visual Identity (stored as a Blob URL for color
  // extraction). Placed at the conventional /images/logo.png the template reads.
  if (loc.visualLogoUrl) {
    const ext = loc.visualLogoUrl.split("?")[0].endsWith(".svg") ? "svg" : "png";
    await downloadUrl(loc.visualLogoUrl, `${imagesDir}/logo.${ext}`);
    // Point the clone's logo references at the fork's own logo (keeps the live
    // Miami template untouched). The template ships with the Miami logo file.
    const logoEdit = [
      { find: `/images/Takeover-logo-WGR.png`, replace: `/images/logo.${ext}` },
    ];
    patchFile(`${targetDir}/src/components/sections/Header.tsx`, logoEdit, "logo (Header)");
    patchFile(`${targetDir}/src/components/sections/Footer.tsx`, logoEdit, "logo (Footer)");
  } else {
    log("  · No logo uploaded (Visual Identity tab) — template logo kept.\n");
  }

  // Per-tour hero photo → tour-1.jpg, tour-2.jpg … in catalog sort order.
  const sortedItems = [...itemRows].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
  );
  let tourN = 0;
  for (const it of sortedItems) {
    const first = (it.photoUrls ?? [])[0];
    if (!first) continue;
    tourN += 1;
    await downloadUrl(first, `${imagesDir}/tour-${tourN}.jpg`);
  }
  if (tourN === 0) {
    log("  · No tour photos uploaded (Tours tab) — none synced.\n");
  }
}

// ---------------------------------------------------------------------------
// Custom-booking transform
//
// Converts a fresh FareHarbor-template clone into a custom-booking site (served
// by book.turbobookings.net via a /book rewrite). Kept in the fork script — NOT
// the template — so the live Miami template's tracking-critical code is never
// touched (per takeovers-site CLAUDE.md). Idempotent-ish and defensive: each
// patch warns if its target text isn't found rather than failing the fork, so
// template drift is visible. The per-company CONTENT rebrand (single vs. many
// tours, copy, dropping locales) stays manual.
// ---------------------------------------------------------------------------

function patchFile(
  path: string,
  edits: { find: string; replace: string }[],
  label: string,
): void {
  if (!existsSync(path)) {
    log(`  ! ${label}: ${path.split("/").slice(-2).join("/")} not found — skipped\n`);
    return;
  }
  let src = readFileSync(path, "utf8");
  for (const { find, replace } of edits) {
    if (src.includes(find)) {
      src = src.replace(find, replace);
    } else {
      log(`  ! ${label}: expected snippet not found (template drift?) — skipped one edit\n`);
    }
  }
  writeFileSync(path, src);
}

function applyCustomBookingTransform(targetDir: string, slug: string): void {
  const src = `${targetDir}/src`;

  // 1. next.config.ts — /book rewrite to the booking app; drop the template's
  //    Miami/Wix redirect map (a fresh domain has no legacy URLs).
  writeFileSafe(
    `${targetDir}/next.config.ts`,
    `import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Custom booking system: /book/* is proxied to the booking app so the address
// bar stays on this location's domain and all pixels/cookies stay first-party.
const BOOKING_APP = "https://book.turbobookings.net/${slug}";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/images/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      { source: "/book", destination: BOOKING_APP },
      { source: "/book/:path*", destination: \\\`\${BOOKING_APP}/:path*\\\` },
    ];
  },
};

export default withNextIntl(nextConfig);
`,
  );

  // 2. src/lib/booking.ts — repoint every CTA to /book. A Proxy returns "/book"
  //    for any TOUR_URLS key so this works regardless of the tour set.
  writeFileSafe(
    `${src}/lib/booking.ts`,
    `// Custom booking system: every "Book" CTA points at /book, which
// next.config.ts rewrites to the booking app. Customers land on this
// location's tour list and pick there.

export const BOOK_URL = "/book";

// Any tour key resolves to /book (the marketing tour cards can deep-link to
// /book/tours/<item> once wired to the real catalog).
export const TOUR_URLS = new Proxy({} as Record<string, string>, {
  get: () => "/book",
});

export type TourKey = string;
`,
  );

  // 3. src/lib/tracking.ts — demote the book-click from InitiateCheckout to a
  //    custom BookClick event so the booking app's InitiateCheckout isn't
  //    double-counted. (Keeps tour content_ids for retargeting.)
  patchFile(
    `${src}/lib/tracking.ts`,
    [
      {
        find: `  const id = trackEvent("InitiateCheckout", {
    content_name: tourName,
    content_ids: [tourId],
    content_type: "product",
    value: tourPrice,
    currency: "USD",
    button_location: buttonLocation,
  });
  trackGAInitiateCheckout(tourName, tourId, tourPrice, buttonLocation);`,
        replace: `  const id = trackEvent(
    "BookClick",
    {
      content_name: tourName,
      content_ids: [tourId],
      content_type: "product",
      value: tourPrice,
      currency: "USD",
      button_location: buttonLocation,
    },
    { custom: true },
  );
  trackGACustomEvent("book_click", {
    content_name: tourName,
    content_ids: [tourId],
    value: tourPrice,
    currency: "USD",
    button_location: buttonLocation,
  });`,
      },
      {
        find: `  trackGACustomEvent,
  trackGAInitiateCheckout,
  trackGAPageView,`,
        replace: `  trackGACustomEvent,
  trackGAPageView,`,
      },
    ],
    "tracking.ts BookClick",
  );

  // 4. Env-gate the tracking IDs so a fork never inherits the template's pixel.
  patchFile(
    `${src}/components/tracking/MetaPixel.tsx`,
    [{ find: `const PIXEL_ID = "516637097197570";`, replace: `const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID ?? "";` }],
    "MetaPixel env-gate",
  );
  patchFile(
    `${src}/components/tracking/MetaPixel.tsx`,
    [{ find: `  return (\n    <>\n      <Script\n        id="meta-pixel-base"`, replace: `  if (!PIXEL_ID) return null;\n\n  return (\n    <>\n      <Script\n        id="meta-pixel-base"` }],
    "MetaPixel guard",
  );
  patchFile(
    `${src}/app/api/meta-capi/route.ts`,
    [{ find: `const PIXEL_ID = "516637097197570";`, replace: `const PIXEL_ID = process.env.META_PIXEL_ID ?? process.env.NEXT_PUBLIC_META_PIXEL_ID ?? "";` }],
    "meta-capi env-gate",
  );

  // 5. Remove the FareHarbor-only machinery (dead without FareHarbor). The
  //    booking app owns Purchase; there is no lightframe, webhook, or intent
  //    bridge here.
  for (const p of [
    `${src}/app/api/webhooks/fareharbor`,
    `${src}/app/api/booking-intent`,
    `${src}/lib/booking-intent-store.ts`,
    `${src}/components/tracking/BookingLinkDecorator.tsx`,
    `${src}/lib/ad-tracking.ts`,
  ]) {
    if (existsSync(p)) rmSync(p, { recursive: true, force: true });
  }

  // 6. Patch layout — drop the FareHarbor lightframe script + BookingLinkDecorator.
  patchFile(
    `${src}/app/[locale]/layout.tsx`,
    [
      { find: `import { BookingLinkDecorator } from "@/components/tracking/BookingLinkDecorator";\n`, replace: `` },
      { find: `          <BookingLinkDecorator />\n`, replace: `` },
      {
        find: `        <Script
          src="https://fareharbor.com/embeds/api/v1/?autolightframe=yes"
          strategy="afterInteractive"
        />\n`,
        replace: ``,
      },
    ],
    "layout FareHarbor removal",
  );

  log("  · Content rebrand (tours, copy, locales) remains a manual pass.\n");
}

// ---------------------------------------------------------------------------
// GitHub repo creation via gh CLI
// ---------------------------------------------------------------------------

async function createGithubRepoAndPush(
  cwd: string,
  slug: string,
  loc: Location,
): Promise<string> {
  const repoName = `${slug}-atv-rentals-site`;
  const description = `${loc.brandDisplayName} — ${loc.brandLocationLabel} marketing site. Forked from takeovers-site by the TurboBookings Dashboard.`;

  await run("gh", [
    "repo",
    "create",
    `${GITHUB_ORG}/${repoName}`,
    "--private",
    "--description",
    description,
    "--source",
    cwd,
    "--remote",
    "origin",
    "--push",
  ]);

  return `https://github.com/${GITHUB_ORG}/${repoName}`;
}

// ---------------------------------------------------------------------------
// Operator follow-ups summary
// ---------------------------------------------------------------------------

function printFollowUps({
  slug,
  push,
  repoUrl,
  loc,
  customBooking,
}: {
  slug: string;
  push: boolean;
  repoUrl: string | null;
  loc: Location;
  customBooking?: boolean;
}): void {
  log("\n────────────────────────────────────────────────\n");
  log(`✓ Fork complete for ${loc.brandDisplayName} (${slug})\n`);
  log("────────────────────────────────────────────────\n\n");

  if (!push) {
    log("Repo is local only. Re-run with --push to create the GitHub repo.\n\n");
  } else if (repoUrl) {
    log(`Repo: ${repoUrl}\n\n`);
  }

  if (customBooking) {
    log("Custom-booking location — wire the site to the booking system:\n");
    log(`  1. next.config.ts: add a rewrite /book/:path* → https://book.turbobookings.net/${slug}/:path*\n`);
    log("  2. Repoint every 'Book' CTA off FareHarbor to /book/... (src/lib/booking.ts) and demote the book-click event from InitiateCheckout to a custom BookClick\n");
    log("  3. Delete the FareHarbor-only tracking (src/app/api/webhooks/fareharbor, BookingLinkDecorator, /api/booking-intent) — the booking app owns Purchase\n");
    log("  4. Set the fresh Meta pixel + GA4 IDs in the tracking components\n");
    log("  5. Create a Vercel project, set env (tracking IDs, base URL), deploy a preview\n");
    log("  6. Configure DNS — apex + www → Vercel; send. subdomain for Resend\n");
    log(`  7. In the dashboard Tracking tab: set pixel/GA4/Ads IDs, flip meta_capi_purchase_enabled ON, paste the META_CAPI_TOKEN secret\n`);
    log(`  8. When healthy, transition status to "launched" in the dashboard Settings tab\n\n`);
  } else {
    log("Remaining manual steps (auto-Vercel-provisioning lands in a follow-up):\n");
    log("  1. Create a Vercel project from the GitHub repo at https://vercel.com/new\n");
    log(`  2. Connect Neon + Vercel Blob marketplace integrations on the project\n`);
    log("  3. Provision a Vercel Edge Config and connect it to the project\n");
    log("  4. Set env vars from .env.local.example (Resend, Twilio, FareHarbor secrets — paste in the dashboard's Integrations tab once VERCEL_API_TOKEN is configured)\n");
    log("  5. Configure DNS — apex + www → Vercel; send. subdomain for Resend\n");
    log("  6. Submit FareHarbor webhook URL via the dashboard's Setup tab\n");
    log("  7. Verify Meta domain + GA4 + (optional) GTM in the dashboard's Tracking tab\n");
    log(`  8. When healthy, transition status to "launched" in the dashboard Settings tab\n\n`);
  }

  log("Files you may still want to delete manually before launch:\n");
  log("  · src/app/[locale]/blog/why-takeovers-is-miamis-best-atv-tour/  (Miami-only SEO page)\n");
  log("  · src/app/[locale]/groups/  (only if this location doesn't run groups)\n");
  log("  · src/messages/es.json + Spanish i18n setup if locales = ['en'] only\n");
  log("  · Anything under docs/ that's Miami-specific\n\n");
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function scriptDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

function writeFileSafe(path: string, content: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function fail(msg: string): never {
  console.error(`\n× ${msg}\n`);
  process.exit(1);
}

function log(s: string): void {
  process.stdout.write(s);
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function run(
  cmd: string,
  args: string[],
  opts: SpawnOptions = {},
): Promise<void> {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(cmd, args, {
      stdio: ["inherit", "pipe", "pipe"],
      ...opts,
    });

    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);

    child.on("close", (code) => {
      if (code === 0) resolveP();
      else rejectP(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`));
    });
    child.on("error", rejectP);
  });
}

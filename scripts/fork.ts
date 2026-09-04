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
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
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
    log(`Re-syncing assets + brand → ${targetDir}\n`);
    await downloadAllAssets(targetDir, groupedAssets, loc!, itemRows);
    log("✓ Assets re-synced under /public/images/\n");
    applyBrandIdentity(targetDir, loc!);
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
  writeSiteConfig(targetDir, loc!, { customBooking, slug: slug! });
  log("✓ Generated src/config/site.ts\n");

  // 4b. Apply brand identity (colors + deposit copy) from the dashboard.
  applyBrandIdentity(targetDir, loc!);

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

  // 6c. Brand linter — surfaces any Miami placeholders that still need a manual
  //     content pass (prose isn't auto-generated). Non-fatal: the operator fixes
  //     what it reports, then re-runs `npm run lint:brand`.
  try {
    log("→ Checking for leftover template placeholders (lint:brand)…\n");
    await run("node", ["scripts/lint-brand.mjs"], { cwd: targetDir });
    log("✓ No Miami placeholders remain\n");
  } catch {
    log("  ! Brand linter found leftovers (see above) — finish the content pass, then re-run `npm run lint:brand`.\n");
  }

  // 7. Prune the template's Miami-only docs and leave a pointer to the synced ones.
  //    This used to be a printed follow-up that nobody performed: Dallas shipped ~1,600 lines
  //    describing Miami's pixel, Miami's GA4 property and a FareHarbor webhook route that does
  //    not exist in that repo. Removing them is mechanical, so it happens here.
  //    Miami-specific SEO pages and the ES locale stay manual — they depend on whether the
  //    client runs groups / wants Spanish — and remain in the printed follow-ups.
  pruneTemplateDocs(targetDir, loc);

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

function writeSiteConfig(
  targetDir: string,
  loc: Location,
  opts: { customBooking?: boolean; slug: string } = { slug: "" },
): void {
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
  /** Only set on custom-booking forks (not FareHarbor sites). Drives the
   * email-capture popup: which location to read config/post leads for, and the
   * booking-app origin that serves /api/popup-config + /api/leads. */
  customBooking?: {
    slug: string;
    bookingOrigin: string;
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
  },${
    opts.customBooking
      ? `\n  customBooking: {\n    slug: ${JSON.stringify(opts.slug)},\n    bookingOrigin: ${JSON.stringify(
          process.env.BOOKING_APP_URL ?? "https://book.turbobookings.net",
        )},\n  },`
      : ""
  }
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

  // Gallery photos numbered in order. Template references gallery-1 through
  // gallery-8 — we honor that ceiling but allow fewer. (Optimized on upload,
  // so these are already small; kept at fixed names.)
  for (let i = 0; i < Math.min(grouped.gallery_photo.length, 8); i++) {
    const asset = grouped.gallery_photo[i];
    const ext = asset.contentType.includes("png") ? "png" : "jpg";
    await downloadOne(asset, `${imagesDir}/gallery-${i + 1}.${ext}`);
  }
}

// Regex-replace across the clone's source tree. Used to retarget asset
// references onto content-hashed filenames (works on both the initial fork and
// --assets-only re-syncs, since it matches any prior hash).
function replaceInTree(root: string, pattern: RegExp, replacement: string): number {
  let count = 0;
  let entries: string[] = [];
  try {
    entries = readdirSync(root, { recursive: true }) as string[];
  } catch {
    return 0;
  }
  for (const rel of entries) {
    if (!/\.(tsx?|json|css|mjs)$/.test(rel)) continue;
    const full = `${root}/${rel}`;
    try {
      const src = readFileSync(full, "utf8");
      if (pattern.test(src)) {
        writeFileSync(full, src.replace(pattern, replacement));
        count += 1;
      }
    } catch {
      /* directory entry / unreadable — skip */
    }
  }
  return count;
}

// Download a big bandwidth asset (hero video / OG image) to a CONTENT-HASHED
// filename and retarget the template's references to it. Combined with the
// immutable cache header, this means replacing an asset always busts the CDN +
// browser cache (the URL changes), while unchanged assets stay cached. Removes
// stale prior versions to avoid orphan bytes.
async function syncVersioned(
  targetDir: string,
  asset: Asset | undefined,
  base: string,
  ext: string,
): Promise<void> {
  if (!asset) return;
  const res = await fetch(asset.blobUrl);
  if (!res.ok) {
    log(`  ! Failed to download ${asset.blobUrl} (${res.status}) — skipping\n`);
    return;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const hash = createHash("sha256").update(buf).digest("hex").slice(0, 8);
  const imagesDir = `${targetDir}/public/images`;
  const newName = `${base}-${hash}.${ext}`;

  // Remove any prior <base>-*.<ext> (template's -v2 file or an older hash).
  for (const f of readdirSync(imagesDir)) {
    if (new RegExp(`^${base}-[a-zA-Z0-9]+\\.${ext}$`).test(f) && f !== newName) {
      rmSync(`${imagesDir}/${f}`, { force: true });
    }
  }
  writeFileSafe(`${imagesDir}/${newName}`, buf);

  // Retarget every reference (template ships <base>-v2.<ext>; re-syncs carry an
  // older hash) to the new hashed name.
  const pattern = new RegExp(`${base}-[a-zA-Z0-9]+\\.${ext}`, "g");
  const n = replaceInTree(`${targetDir}/src`, pattern, newName);
  log(`  ✓ ${newName} (${formatBytes(buf.length)}, ${n} ref${n === 1 ? "" : "s"})\n`);
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

  // Big bandwidth assets → content-hashed filenames (cache-bust on replace).
  await syncVersioned(targetDir, grouped.hero_desktop[0], "hero-desktop", "mp4");
  await syncVersioned(targetDir, grouped.hero_mobile[0], "hero-mobile", "mp4");
  await syncVersioned(targetDir, grouped.og_image[0], "og-image", "jpg");

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

// Apply the location's brand identity from the dashboard onto the cloned site:
// swap the template's Miami palette (primary/gold/neon) for the location's
// visual_primary_color / visual_accent_color across the whole src tree (globals
// @theme, lib/tokens, component literals, favicon, themeColor), and inject the
// deposit dollar amount into the marketing copy. Fonts remain a documented
// manual step (arbitrary next/font names); the brand linter flags leftovers.
function applyBrandIdentity(targetDir: string, loc: Location): void {
  const src = `${targetDir}/src`;
  const primary = (loc.visualPrimaryColor ?? "").trim();
  const accent = (loc.visualAccentColor ?? primary).trim();
  if (primary) {
    let n = 0;
    n += replaceInTree(src, /#c8102e/gi, primary);
    n += replaceInTree(src, /#8a0a1e/gi, primary); // darker Miami red (gradients)
    if (accent) {
      n += replaceInTree(src, /#d4a853/gi, accent); // gold
      n += replaceInTree(src, /#39ff14/gi, accent); // neon
    }
    patchFile(
      `${targetDir}/src/app/icon.svg`,
      [{ find: "#C8102E", replace: primary.toUpperCase() }],
      "Favicon color",
    );
    log(`✓ Brand colors applied — primary ${primary}${accent ? `, accent ${accent}` : ""} (${n} file refs)\n`);
  } else {
    log("  ! Brand: no visual_primary_color on the location — kept the template palette. Set brand colors in the dashboard, then re-run with --assets-only to apply.\n");
  }
  // Deposit dollar amount in marketing copy (per-unit / flat deposits only).
  // "$$" in the replacement escapes to a literal "$" in String.replace.
  if (loc.depositAmountCents != null && loc.depositMode !== "full") {
    const dollars = Math.round(loc.depositAmountCents / 100);
    const n = replaceInTree(src, /\$50\b/g, `$$${dollars}`);
    if (n) log(`✓ Deposit copy set to $${dollars} (${n} file(s))\n`);
  }
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
    [{ find: `  return (\n    <>\n      <Script\n        id="meta-pixel-base"`, replace: `  if (!PIXEL_ID) {\n    if (process.env.NODE_ENV === "production") {\n      console.error(\n        "[tracking] Meta Pixel NOT rendered — NEXT_PUBLIC_META_PIXEL_ID is unset. This site is not tracking conversions.",\n      );\n    }\n    return null;\n  }\n\n  return (\n    <>\n      <Script\n        id="meta-pixel-base"` }],
    "MetaPixel guard",
  );
  patchFile(
    `${src}/app/api/meta-capi/route.ts`,
    [{ find: `const PIXEL_ID = "516637097197570";`, replace: `const PIXEL_ID = process.env.META_PIXEL_ID ?? process.env.NEXT_PUBLIC_META_PIXEL_ID ?? "";` }],
    "meta-capi env-gate",
  );

  // 4b. Env-gate the GOOGLE ids too. Previously only Meta was gated, so every
  //     fork silently inherited the TEMPLATE's live GA4 property and Ads
  //     account — worse than no tracking: the new location's traffic and
  //     conversions would be reported into Miami's property, corrupting the
  //     data of a live business that has nothing to do with it.
  patchFile(
    `${src}/lib/google-tracking.ts`,
    [
      {
        find: `export const GA_MEASUREMENT_ID = "G-W1737CSQ2C";\nexport const GOOGLE_ADS_ID = "AW-10789560857";\nexport const BOOK_CLICK_CONVERSION_LABEL = "CfiaCJ3JxaEcEJnE7pgo";`,
        replace: `export const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? "";\nexport const GOOGLE_ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID ?? "";\nexport const BOOK_CLICK_CONVERSION_LABEL =\n  process.env.NEXT_PUBLIC_GOOGLE_ADS_BOOK_CLICK_LABEL ?? "";`,
      },
    ],
    "google-tracking env-gate",
  );
  // gtag.js must load off EITHER id. Guarding on GA4 alone would silently kill
  // the Ads tag for a location that runs Ads without a GA4 property.
  patchFile(
    `${src}/components/tracking/GoogleAnalytics.tsx`,
    [
      {
        find: `  return (\n    <>\n      <Script\n        src={\`https://www.googletagmanager.com/gtag/js?id=\${GA_MEASUREMENT_ID}\`}`,
        replace: `  const gtagId = GA_MEASUREMENT_ID || GOOGLE_ADS_ID;\n  if (!gtagId) {\n    if (process.env.NODE_ENV === "production") {\n      console.error(\n        "[tracking] No Google tag rendered — both NEXT_PUBLIC_GA_MEASUREMENT_ID and NEXT_PUBLIC_GOOGLE_ADS_ID are unset.",\n      );\n    }\n    return null;\n  }\n\n  return (\n    <>\n      <Script\n        src={\`https://www.googletagmanager.com/gtag/js?id=\${gtagId}\`}`,
      },
      {
        find: `            gtag('config', '\${GA_MEASUREMENT_ID}', {\n              send_page_view: false\n            });`,
        replace: `            \${GA_MEASUREMENT_ID ? \`gtag('config', '\${GA_MEASUREMENT_ID}', { send_page_view: false });\` : ""}`,
      },
    ],
    "GoogleAnalytics env-gate + either-id loader",
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

/**
 * Delete the template docs that describe MIAMI's infrastructure and leave a README pointing at the
 * docs that are synced across every repo.
 *
 * The fork copies `docs/` forward verbatim. Before this existed, every fork inherited Miami's
 * FareHarbor-Lightframe tracking architecture, Miami's Google Ads SOP, Miami's Wix -> Next SEO
 * migration write-up and Miami's GA4 experiment log — all describing a pixel, a GA4 property and a
 * webhook route the new site does not have. Dallas carried the lot to production; found and removed
 * on 2026-09-04.
 *
 * Conservative on re-runs: if a local `takeovers-site` checkout is present and the fork's copy has
 * diverged from it, the file has been edited since the fork and is left alone.
 */
function pruneTemplateDocs(targetDir: string, loc: Location): void {
  const MIAMI_ONLY = [
    "active-experiments.md",
    "fork-playbook.md",
    "google-ads-tracking-setup-sop.md",
    "google-tracking-architecture.md",
    "meta-tracking-architecture.md",
    "multi-location-architecture.md",
    "seo-migration.md",
    "server-side-tracking-roadmap.md",
    "unified-platform-integration.md",
  ];

  const forkDocs = resolve(targetDir, "docs");
  if (!existsSync(forkDocs)) return;
  const templateDocs = resolve(scriptDir(), "..", "..", "takeovers-site", "docs");

  const removed: string[] = [];
  const kept: string[] = [];
  for (const name of MIAMI_ONLY) {
    const mine = resolve(forkDocs, name);
    if (!existsSync(mine)) continue;
    const theirs = resolve(templateDocs, name);
    if (existsSync(theirs) && readFileSync(mine, "utf8") !== readFileSync(theirs, "utf8")) {
      kept.push(name);
      continue;
    }
    rmSync(mine);
    removed.push(name);
  }

  const brand = loc.brandDisplayName ?? loc.slug;
  writeFileSafe(
    resolve(forkDocs, "README.md"),
    [
      `# ${brand} site docs`,
      "",
      "Only docs that describe **this** site belong here. Anything identical across locations is",
      "maintained once in `turbobookings-dashboard` and synced — do not copy it in.",
      "",
      "| Looking for | Read |",
      "|---|---|",
      "| Tracking, pixels, attribution, click IDs | `docs/TRACKING.md` (synced) |",
      "| Platform topology | `PLATFORM_ARCHITECTURE.md` (synced) |",
      "| Launching a new location | `turbobookings-dashboard/docs/NEW_LOCATION_RUNBOOK.md` |",
      "| Miami-era history (FareHarbor, SEO migration, GA4 experiments) | `~/takeovers-site/docs/` |",
      "",
      removed.length
        ? `Removed at fork time as Miami-specific: ${removed.join(", ")}.`
        : "No Miami-specific docs were present at fork time.",
      ...(kept.length
        ? ["", `Left in place because they had local edits — review by hand: ${kept.join(", ")}.`]
        : []),
      "",
    ].join("\n"),
  );

  log(
    `✓ Pruned ${removed.length} Miami-only doc(s)` +
      (kept.length ? `, kept ${kept.length} with local edits` : "") +
      ", wrote docs/README.md\n",
  );
}

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

  // The single most consequential follow-up, and the one most easily skipped.
  // A fork ships with every tracking id env-gated to "", so the site renders
  // perfectly and reports nothing. Dallas reached production in exactly this
  // state. Make it impossible to miss.
  log("\n");
  log("  ============================================================\n");
  log("  ⚠️  TRACKING IS NOT CONFIGURED — THIS SITE REPORTS NOTHING\n");
  log("  ============================================================\n");
  log("  Set these in the new Vercel project (Production), then REDEPLOY —\n");
  log("  they are build-time values, so setting them alone changes nothing:\n\n");
  log("    NEXT_PUBLIC_META_PIXEL_ID                 (client pixel)\n");
  log("    META_PIXEL_ID                             (server CAPI relay)\n");
  log("    META_CAPI_TOKEN                           (secret — Integrations tab)\n");
  log("    NEXT_PUBLIC_GA_MEASUREMENT_ID             (GA4)\n");
  log("    NEXT_PUBLIC_GOOGLE_ADS_ID                 (Ads)\n");
  log("    NEXT_PUBLIC_GOOGLE_ADS_BOOK_CLICK_LABEL   (Ads conversion label)\n\n");
  log("  Use a FRESH pixel/property per location — never reuse another\n");
  log("  location's, or you corrupt a live business's reporting.\n");
  log("  Verify after deploy:  Dashboard → Tracking → Verify now\n");
  log("  ============================================================\n\n");

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

#!/usr/bin/env node
/**
 * Sync the SHARED half of the cross-repo docs into every repo that carries a copy.
 *
 * Each managed doc is split by an ANCHOR HEADING. Everything from that heading down is common to all
 * repos; everything above it is that repo's own role header and must survive untouched.
 *
 * Hand-maintaining seven copies did not work: by 2026-08-21 they carried three different status dates
 * and disagreed about whether the booking system was live. One of them also claimed the cockpit reads
 * ROAS from a Neon database that does not exist, which sent a whole research session down a dead end.
 *
 *   npm run docs:sync            # report what would change
 *   npm run docs:sync -- --check  # exit 1 if any copy has drifted (for CI)
 *   npm run docs:sync -- --write
 *
 * ── WHY THIS FILE WAS REWRITTEN (2026-09-04) ─────────────────────────────────────────────────────
 * The previous version matched the anchor with an unanchored `String.indexOf`. PLATFORM_ARCHITECTURE.md
 * mentions its own anchor inside backticks on line 3 ("Everything from `## The decision (read this
 * first)` down is SHARED"), so indexOf found LINE 3, not the real heading. "Shared" therefore began
 * mid-sentence and swallowed the banner plus the dashboard's own role header, and the 2026-08-27 run
 * wrote that into all six non-canonical repos. Every one of them ended up with two `## This repo's
 * role` sections — the second being the DASHBOARD's — and a broken heading with a stray backtick.
 *
 * The `NO ANCHOR` guard could not catch it, because a corrupted file still contains the string.
 *
 * The fix is to match the anchor as a WHOLE LINE. `anchorIndexIn()` below deliberately accepts
 * trailing junk after the heading text so that it also lands on the corrupted `## The decision (read
 * this first)` down is` line — which means one --write both repairs the damage and re-syncs.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const REPOS = [
  "turbobookings-dashboard",
  "bookingsystem",
  "ads/SHARED",
  "takeovers-site",
  "htown-atv-rentals-site",
  "dtown-atv-rentals-site",
  "takeovers-platform",
];

/** Just the marketing sites — the shared PLUMBING lives here, not in the dashboard or booking app. */
const SITE_REPOS = ["takeovers-site", "htown-atv-rentals-site", "dtown-atv-rentals-site"];

/**
 * Every doc or code file that lives in more than one repo. `canonicalRepo` holds the copy that is
 * edited by hand; every other repo receives it verbatim.
 *
 * Entries are one of two kinds:
 *   anchored  (docs) — everything from `anchor` down is shared, the header above it is the repo's own
 *   wholeFile (code) — the entire file is shared, and copies get a 🔒 banner
 */
const DOCS = [
  {
    file: "PLATFORM_ARCHITECTURE.md",
    anchor: "## The decision (read this first)",
    canonicalRepo: "turbobookings-dashboard",
    repos: REPOS,
  },
  // ---- SHARED CODE ---------------------------------------------------------------------------
  //
  // Whole-file entries: no anchor, the file is identical end to end. These are the marketing-site
  // PLUMBING — the layer where two copies differing is always a bug, never a feature.
  //
  // Presentation is deliberately NOT here. Of Miami's 23 section components only 4 are identical
  // across the three sites, and that is correct: clients should not look like copies of each other.
  // What must never diverge is how a click becomes an attributed booking.
  //
  // The cost of not having this was measured: the `tb_aid` fix on 2026-09-04 had to be written three
  // times, once per repo, and `google-tracking.ts` had drifted into three different shapes.
  ...[
    "src/lib/google-tracking.ts",
    "src/lib/cookies.ts",
    "src/lib/anonymousId.ts",
    "src/components/tracking/MetaPixel.tsx",
    "src/components/tracking/GoogleAnalytics.tsx",
    "src/components/tracking/PageTracker.tsx",
    "src/components/tracking/TelLink.tsx",
  ].map((file) => ({
    file,
    canonicalRepo: "takeovers-site",
    repos: SITE_REPOS,
    // Per-site identity lives in siteConfig.tracking, so these files carry no location-specific
    // values and can be byte-identical. See TRK-12.
    wholeFile: true,
  })),

  {
    file: "docs/TRACKING.md",
    anchor: "## How attribution works (read this first)",
    canonicalRepo: "turbobookings-dashboard",
    // The cockpit keeps its docs under cockpit/, not docs/ — hence the override.
    repos: REPOS.map((r) => (r === "ads/SHARED" ? { repo: r, file: "cockpit/TRACKING.md" } : r)),
  },
];

const WRITE = process.argv.includes("--write");
const CHECK = process.argv.includes("--check");

/**
 * Index of the anchor HEADING, matched as a whole line.
 *
 * `exact` demands the line be nothing but the heading — used for the canonical copy, so a prose
 * mention can never be mistaken for the split point.
 *
 * Non-exact additionally accepts a line that STARTS with the heading and carries trailing text. That
 * is not sloppiness: it is what lets this repair the corruption described in the header comment,
 * where the anchor line reads "## The decision (read this first)` down is".
 */
function anchorIndexIn(text, anchor, { exact = false } = {}) {
  const lines = text.split("\n");
  let offset = 0;
  for (const line of lines) {
    const hit = exact ? line.trimEnd() === anchor : line.startsWith(anchor);
    if (hit) return offset;
    offset += line.length + 1;
  }
  return -1;
}

/**
 * The header stamped onto every synced CODE copy.
 *
 * Vendored source can still be edited in place — the banner and `--check` make that visible, not
 * impossible. That is the accepted cost of not shipping a private npm package yet: private-repo
 * installs would need a registry token in every Vercel project, and publishing needs the GitHub
 * automation that does not exist in this estate.
 */
function bannerFor(doc, file) {
  const ext = file.slice(file.lastIndexOf("."));
  const line = ext === ".md" ? ">" : "//";
  return [
    `${line} 🔒 SYNCED FILE — DO NOT EDIT HERE.`,
    `${line} Canonical copy: ${doc.canonicalRepo}/${doc.file}`,
    `${line} Edit it there, then run \`npm run docs:sync -- --write\` from turbobookings-dashboard.`,
    `${line} Local edits are overwritten on the next sync; \`npm run docs:check\` exits 1 on drift.`,
    "",
    "",
  ].join("\n");
}

let drifted = 0;
let missing = 0;
let repaired = 0;

for (const doc of DOCS) {
  const canonFile = join(homedir(), doc.canonicalRepo, doc.file);
  if (!existsSync(canonFile)) {
    if (doc.optional) continue;
    console.error(`Canonical ${doc.file} not found at ${canonFile} — refusing to sync.`);
    process.exit(1);
  }

  const canon = readFileSync(canonFile, "utf8");

  let shared;
  if (doc.wholeFile) {
    // Code: the whole file is shared, so there is no anchor to find. A banner is prepended at write
    // time rather than stored in the canonical file, so the canonical copy stays ordinary source you
    // can lint, typecheck and reason about without a marker in the way.
    shared = canon;
  } else {
    const canonAt = anchorIndexIn(canon, doc.anchor, { exact: true });
    if (canonAt === -1) {
      console.error(
        `Canonical ${doc.file} has no line that is exactly "${doc.anchor}" — refusing to sync.`,
      );
      process.exit(1);
    }
    shared = canon.slice(canonAt);
  }

  console.log(`\n${doc.file}  (canonical: ${doc.canonicalRepo})`);

  for (const entry of doc.repos) {
    const repo = typeof entry === "string" ? entry : entry.repo;
    const file = join(homedir(), repo, (typeof entry === "string" ? null : entry.file) ?? doc.file);
    if (!existsSync(file)) {
      if (!doc.optional) {
        console.log(`  MISSING    ${repo}`);
        missing++;
      }
      continue;
    }

    const cur = readFileSync(file, "utf8");

    if (doc.wholeFile) {
      // The canonical repo holds the source of truth and needs no banner in its own copy.
      const next =
        repo === doc.canonicalRepo ? shared : bannerFor(doc, file) + shared;
      if (next === cur) {
        console.log(`  ok         ${repo}`);
        continue;
      }
      drifted++;
      if (WRITE) {
        writeFileSync(file, next);
        console.log(`  SYNCED     ${repo}  ${doc.file}`);
      } else {
        console.log(`  WOULD SYNC ${repo}  ${doc.file}`);
      }
      continue;
    }

    const at = anchorIndexIn(cur, doc.anchor);
    if (at === -1) {
      // Never guess where the split is — a wrong guess silently deletes a repo's role header.
      console.log(`  NO ANCHOR  ${repo}  (skipped — add the heading by hand first)`);
      missing++;
      continue;
    }

    // A copy is CORRUPT if its anchor line carries trailing text, or if the role header repeats.
    const anchorLine = cur.slice(at).split("\n")[0].trimEnd();
    const corrupt =
      anchorLine !== doc.anchor ||
      (cur.slice(0, at).match(/^## This repo's role$/gm) ?? []).length > 1;

    const next = cur.slice(0, at) + shared;
    if (next === cur) {
      console.log(`  ok         ${repo}`);
      continue;
    }

    drifted++;
    if (corrupt) repaired++;
    const label = corrupt ? "REPAIR" : "SYNC";
    if (WRITE) {
      writeFileSync(file, next);
      console.log(`  ${corrupt ? "REPAIRED  " : "SYNCED    "} ${repo}`);
    } else {
      console.log(`  WOULD ${label.padEnd(6)} ${repo}`);
    }
  }
}

console.log("");
if (CHECK) {
  if (drifted || missing) {
    console.error(
      `Shared docs have drifted: ${drifted} cop${drifted === 1 ? "y" : "ies"} out of date` +
        (missing ? `, ${missing} unreachable` : "") +
        `. Run \`npm run docs:sync -- --write\`.`,
    );
    process.exit(1);
  }
  console.log("All shared doc copies are in sync.");
  process.exit(0);
}

console.log(
  `${WRITE ? "Synced" : "Would sync"} ${drifted} cop${drifted === 1 ? "y" : "ies"}` +
    (repaired ? ` (${repaired} corrupted by the old indexOf bug)` : "") +
    (missing ? `, ${missing} skipped` : "") +
    (WRITE ? ". Commit each repo separately." : ". Re-run with --write to apply."),
);

#!/usr/bin/env node
/**
 * Sync the SHARED half of PLATFORM_ARCHITECTURE.md into every repo that carries a copy.
 *
 * The file lives in seven repos. Everything from `## The decision (read this first)` down is common;
 * everything above it is that repo's own "This repo's role" header and must survive untouched.
 *
 * Hand-maintaining seven copies did not work: by 2026-08-21 they carried three different status dates
 * and disagreed about whether the booking system was live. One of them also claimed the cockpit reads
 * ROAS from a Neon database that does not exist, which sent a whole research session down a dead end.
 *
 *   npm run arch:sync           # report what would change
 *   npm run arch:sync -- --write
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";

const ANCHOR = "## The decision (read this first)";
const CANON = join(homedir(), "turbobookings-dashboard", "PLATFORM_ARCHITECTURE.md");
const REPOS = [
  "turbobookings-dashboard",
  "bookingsystem",
  "ads/SHARED",
  "takeovers-site",
  "htown-atv-rentals-site",
  "dtown-atv-rentals-site",
  "takeovers-platform",
].map((r) => join(homedir(), r));

const WRITE = process.argv.includes("--write");

const canon = readFileSync(CANON, "utf8");
if (!canon.includes(ANCHOR)) {
  console.error(`Canonical copy has no "${ANCHOR}" anchor — refusing to sync.`);
  process.exit(1);
}
const shared = canon.slice(canon.indexOf(ANCHOR));

let changed = 0;
let missing = 0;
for (const repo of REPOS) {
  const file = join(repo, "PLATFORM_ARCHITECTURE.md");
  const name = repo.replace(homedir() + "/", "");
  if (!existsSync(file)) {
    console.log(`  MISSING    ${name}`);
    missing++;
    continue;
  }
  const cur = readFileSync(file, "utf8");
  if (!cur.includes(ANCHOR)) {
    // Never guess where the split is — a wrong guess silently deletes a repo's role header.
    console.log(`  NO ANCHOR  ${name}  (skipped — add the heading by hand first)`);
    missing++;
    continue;
  }
  const next = cur.slice(0, cur.indexOf(ANCHOR)) + shared;
  if (next === cur) {
    console.log(`  ok         ${name}`);
    continue;
  }
  changed++;
  if (WRITE) {
    writeFileSync(file, next);
    console.log(`  SYNCED     ${name}`);
  } else {
    console.log(`  WOULD SYNC ${name}`);
  }
}

console.log(
  `\n${WRITE ? "Synced" : "Would sync"} ${changed} cop${changed === 1 ? "y" : "ies"}` +
    (missing ? `, ${missing} skipped` : "") +
    (WRITE ? ". Commit each repo separately." : ". Re-run with --write to apply."),
);

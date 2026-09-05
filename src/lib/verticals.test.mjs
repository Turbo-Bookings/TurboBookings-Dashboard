// Run: node src/lib/verticals.test.mjs
// Pure-function proof of the vertical vocabulary rules. Mirrors verticals.ts — keep in sync.
//
// The rule worth protecting is the fallback: NULL means "use the vertical default", never "blank".
// A cleared form field arrives as "" and must fall back too, or a site renders "Book your " with a
// hole where the noun should be.

const VERTICAL_PRESETS = {
  atv:             { layout: "tour_operator",    unitNoun: "ATV",     unitNounPlural: "ATVs" },
  jetski:          { layout: "equipment_rental", unitNoun: "jetski",  unitNounPlural: "jetskis" },
  yacht_charter:   { layout: "vessel_charter",   unitNoun: "yacht",   unitNounPlural: "yachts" },
  fishing_charter: { layout: "vessel_charter",   unitNoun: "boat",    unitNounPlural: "boats" },
  excursion:       { layout: "tour_operator",    unitNoun: "tour",    unitNounPlural: "tours" },
};

function vocabularyFor(loc) {
  const preset = VERTICAL_PRESETS[loc.vertical] ?? VERTICAL_PRESETS.atv;
  return {
    ...preset,
    unitNoun: loc.unitNoun?.trim() || preset.unitNoun,
    unitNounPlural: loc.unitNounPlural?.trim() || preset.unitNounPlural,
  };
}
function layoutFor(loc) {
  return loc.templateLayout ?? VERTICAL_PRESETS[loc.vertical]?.layout ?? "tour_operator";
}

let failures = 0;
function check(name, got, want) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
}

// Defaults come from the vertical.
check("atv default noun", vocabularyFor({ vertical: "atv" }).unitNoun, "ATV");
check("yacht default noun", vocabularyFor({ vertical: "yacht_charter" }).unitNoun, "yacht");

// A per-location override wins — the reason unit_noun is a column at all. Two ATV operators
// disagree: one sells "ATVs", one sells "buggies".
check(
  "operator override wins",
  vocabularyFor({ vertical: "atv", unitNoun: "buggy" }).unitNoun,
  "buggy",
);

// NULL and "" both mean "use the default". A cleared field must not render a hole.
check("null falls back", vocabularyFor({ vertical: "atv", unitNoun: null }).unitNoun, "ATV");
check("empty string falls back", vocabularyFor({ vertical: "atv", unitNoun: "" }).unitNoun, "ATV");
check("whitespace falls back", vocabularyFor({ vertical: "atv", unitNoun: "   " }).unitNoun, "ATV");

// Overriding the singular must not silently change the plural.
check(
  "plural independent of singular",
  vocabularyFor({ vertical: "atv", unitNoun: "buggy" }).unitNounPlural,
  "ATVs",
);

// Two verticals share one layout — the whole point of keeping the axes separate.
check("yacht layout", layoutFor({ vertical: "yacht_charter" }), "vessel_charter");
check("fishing layout", layoutFor({ vertical: "fishing_charter" }), "vessel_charter");
check("explicit layout overrides vertical default",
  layoutFor({ vertical: "yacht_charter", templateLayout: "tour_operator" }), "tour_operator");

// An unknown vertical (a value added to the DB enum before this file) must degrade, not throw.
check("unknown vertical degrades", vocabularyFor({ vertical: "helicopter" }).unitNoun, "ATV");

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);

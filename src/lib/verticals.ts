/**
 * Vertical presets — the vocabulary and structure a location inherits from WHAT it sells.
 *
 * The platform grew up ATV-shaped. The storefront says "tour" in every string, the fork writes repos
 * named `<slug>-atv-rentals-site`, and the single template is Miami's live ATV site. None of that
 * fits a yacht charter, and an operator whose booking flow calls their catamaran a "tour" with a
 * "rider count" will not sign.
 *
 * TWO AXES, deliberately separate:
 *
 *   vertical  — what they sell. Drives words and schema.org type.
 *   layout    — which page structure the site is built on.
 *
 * They are not the same thing, and collapsing them is the expensive mistake. A yacht charter and a
 * fishing charter want the same PAGE (a vessel, a captain, a duration, a party size) and different
 * WORDS. Five verticals over three layouts means adding a sixth vertical is a row in this file;
 * folding them together would mean a sixth codebase, which is the same duplication that left seven
 * copies of one architecture doc disagreeing with each other.
 *
 * No `server-only` import: the marketing sites and the storefront both read this.
 */

export type Vertical =
  | "atv"
  | "jetski"
  | "yacht_charter"
  | "fishing_charter"
  | "excursion";

export type TemplateLayout = "tour_operator" | "vessel_charter" | "equipment_rental";

export type VerticalPreset = {
  /** Default page structure. A location may override it — see `locations.template_layout`. */
  layout: TemplateLayout;
  /** One sellable unit, and many. Operators override these per location. */
  unitNoun: string;
  unitNounPlural: string;
  /** What a booking IS, in the customer's words: "tour", "rental", "charter", "trip". */
  experienceNoun: string;
  /** The call to action. "Book your tour" reads wrong for a jetski by the hour. */
  bookVerb: string;
  /** What we count per booking. Riders, guests, passengers, anglers. */
  participantNoun: string;
  participantNounPlural: string;
  /**
   * schema.org `@type` for the product/offer JSON-LD.
   *
   * Google treats these differently in rich results, so a charter marked up as a generic
   * TouristAttraction competes in the wrong category. `Product` is the safe fallback where no
   * vocabulary term fits — never invent a type, an unrecognised one is silently dropped.
   */
  schemaType: string;
  /** How duration reads on the card: hourly rentals vs half/full-day charters. */
  durationStyle: "hourly" | "half_or_full_day";
};

export const VERTICAL_PRESETS: Record<Vertical, VerticalPreset> = {
  atv: {
    layout: "tour_operator",
    unitNoun: "ATV",
    unitNounPlural: "ATVs",
    experienceNoun: "tour",
    bookVerb: "Book your tour",
    participantNoun: "rider",
    participantNounPlural: "riders",
    schemaType: "TouristAttraction",
    durationStyle: "hourly",
  },
  jetski: {
    layout: "equipment_rental",
    unitNoun: "jetski",
    unitNounPlural: "jetskis",
    experienceNoun: "rental",
    bookVerb: "Reserve your ride",
    participantNoun: "rider",
    participantNounPlural: "riders",
    schemaType: "Product",
    durationStyle: "hourly",
  },
  yacht_charter: {
    layout: "vessel_charter",
    unitNoun: "yacht",
    unitNounPlural: "yachts",
    experienceNoun: "charter",
    bookVerb: "Charter now",
    participantNoun: "guest",
    participantNounPlural: "guests",
    schemaType: "BoatTrip",
    durationStyle: "half_or_full_day",
  },
  fishing_charter: {
    layout: "vessel_charter",
    unitNoun: "boat",
    unitNounPlural: "boats",
    experienceNoun: "trip",
    bookVerb: "Book your trip",
    participantNoun: "angler",
    participantNounPlural: "anglers",
    schemaType: "BoatTrip",
    durationStyle: "half_or_full_day",
  },
  excursion: {
    layout: "tour_operator",
    unitNoun: "tour",
    unitNounPlural: "tours",
    experienceNoun: "experience",
    bookVerb: "Book your experience",
    participantNoun: "guest",
    participantNounPlural: "guests",
    schemaType: "TouristTrip",
    durationStyle: "half_or_full_day",
  },
};

/** Every vertical, for a dashboard select. Order is presentation order. */
export const VERTICALS = Object.keys(VERTICAL_PRESETS) as Vertical[];

export const VERTICAL_LABELS: Record<Vertical, string> = {
  atv: "ATV / off-road",
  jetski: "Jetski / watercraft rental",
  yacht_charter: "Yacht / boat charter",
  fishing_charter: "Fishing charter",
  excursion: "Guided excursion",
};

export const LAYOUT_LABELS: Record<TemplateLayout, string> = {
  tour_operator: "Tour operator — guided, scheduled departures",
  vessel_charter: "Vessel charter — a boat, a captain, a duration",
  equipment_rental: "Equipment rental — by the hour, self-guided",
};

/**
 * The words a given location should use.
 *
 * Per-location overrides win over the vertical default, which is the whole reason `unit_noun` is a
 * nullable column rather than something derived: an ATV shop and a side-by-side shop are both `atv`
 * and call the thing different names. NULL means "use the default", never "blank" — an empty string
 * from a form is treated as absent so a cleared field falls back instead of rendering nothing.
 */
export function vocabularyFor(loc: {
  vertical: Vertical;
  unitNoun?: string | null;
  unitNounPlural?: string | null;
}): VerticalPreset {
  const preset = VERTICAL_PRESETS[loc.vertical] ?? VERTICAL_PRESETS.atv;
  return {
    ...preset,
    unitNoun: loc.unitNoun?.trim() || preset.unitNoun,
    unitNounPlural: loc.unitNounPlural?.trim() || preset.unitNounPlural,
  };
}

/** The layout a location renders on: its explicit choice, else the vertical's default. */
export function layoutFor(loc: {
  vertical: Vertical;
  templateLayout?: TemplateLayout | null;
}): TemplateLayout {
  return loc.templateLayout ?? VERTICAL_PRESETS[loc.vertical]?.layout ?? "tour_operator";
}

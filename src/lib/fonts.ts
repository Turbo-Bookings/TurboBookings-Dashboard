// Curated font options for the per-location visual identity picker. Limited
// on purpose — having ~6 display + ~5 body choices keeps the buildout
// decision lightweight for VAs while covering 95% of brand fits.

export type FontOption = {
  /** Stored in the locations.visual_display_font / _body_font column. Also
   * the CSS `font-family` value (Google Fonts names use the human form). */
  family: string;
  /** Short blurb shown next to the family name in the dropdown. */
  hint: string;
};

export const DISPLAY_FONTS: FontOption[] = [
  { family: "Anton", hint: "Takeovers default — condensed, motorsports feel" },
  { family: "Oswald", hint: "Refined condensed sans" },
  { family: "Bebas Neue", hint: "Wider, cleaner condensed" },
  { family: "Russo One", hint: "Heavier, more aggressive" },
  { family: "Antonio", hint: "Italian-inspired condensed" },
  { family: "Teko", hint: "Modern compressed" },
];

export const BODY_FONTS: FontOption[] = [
  { family: "Inter", hint: "Takeovers default — versatile, readable" },
  { family: "Outfit", hint: "Modern geometric" },
  { family: "Manrope", hint: "Friendlier rounded" },
  { family: "Plus Jakarta Sans", hint: "Editorial feel" },
  { family: "DM Sans", hint: "Compact, clean" },
];

export const TAKEOVERS_DEFAULT_DISPLAY = "Anton";
export const TAKEOVERS_DEFAULT_BODY = "Inter";

// Google Fonts URL that loads every font in this picker at once. Imported
// from the app's root layout so previews render immediately.
const ALL_FAMILIES = [
  ...DISPLAY_FONTS.map((f) => f.family),
  ...BODY_FONTS.map((f) => f.family),
];

export const GOOGLE_FONTS_URL = `https://fonts.googleapis.com/css2?${ALL_FAMILIES.map(
  (f) => `family=${encodeURIComponent(f)}`,
).join("&")}&display=swap`;

# New Location Runbook — launch a touring company's marketing site

The repeatable, team-followable process for taking a new touring company from
"nothing" to a live, branded marketing site wired to the booking system. Any
team member with the right access can follow this — it is not dependent on one
person.

> **Two surfaces, one continuous funnel.** A location has (1) a **marketing
> site** — its own GitHub repo deployed to Vercel on its own domain (static:
> images are baked into the repo), and (2) the shared **booking app**
> (`book.turbobookings.net/<slug>`, surfaced via a `/book` rewrite) which reads
> brand/catalog/prices/tour-photos **live** from the shared DB. The marketing
> site's "Book" buttons route into the booking app while the address bar stays
> on the location's domain, so pixels/cookies stay first-party.

---

## 0. Prerequisites (one-time per operator)

- Dashboard access with a role that can manage the location (operator+ for
  config/assets; Turbo admin for tracking + platform bits).
- To run the generator today you need a dev machine: this repo checked out,
  `DATABASE_URL` in `.env.local`, `gh` logged in, Node installed. *(A dashboard
  "Generate site" button is on the roadmap to remove this — see §12.)*
- Registrar/DNS access for the location's domain.
- Meta Business Manager + Google (Analytics/Ads) access to create the fresh
  tracking accounts.

---

## 1. Create + configure the location (dashboard)

1. **Create the location** and fill the intake: legal name, display brand,
   location label, full address, phone (display + E.164), support email.
2. **Domain:** apex + canonical (e.g. `dtownatvrentals.com`).
3. **Brand:** colors (or upload the logo in §2 and use extracted swatches),
   fonts, theme.
4. **Catalog (Tours):** tours, rider/customer types, prices, deposit mode,
   taxes/fees, cancellation policy. This is what the booking app renders.
5. **Booking mode:** if this location runs on the **custom booking system**
   (no FareHarbor), leave the FareHarbor fields empty — the generator detects
   this. If it's a FareHarbor location, fill the FareHarbor shortname + flow.

## 2. Upload assets (dashboard → Branding & Tours)

Uploads are **auto-optimized** on the way in (resized + recompressed), so you
don't have to hand-optimize images. Provide:

- **Media:** hero video **desktop** + hero video **mobile**, OG image, gallery
  photos.
- **Visual Identity:** the logo (used for the site logo + brand-color
  extraction).
- **Tours:** per-tour photos (these show on the booking `/book` pages and the
  marketing tour cards).

> ⚠️ **Hero videos — billing guardrail.** Videos can't be auto-transcoded at
> upload, so there's a hard size cap (desktop ≤15 MB, mobile ≤12 MB). If yours
> is bigger, encode it first — the upload error shows the exact recipe:
> `ffmpeg -i in.mov -vf "scale=-2:1080" -c:v libx264 -b:v 2M -an -movflags +faststart out.mp4`.
> This exists because an unoptimized 27 MB hero video once caused a $166 Vercel
> bandwidth bill. Images are handled for you.

## 3. Generate the marketing-site repo

From this repo, with `.env.local` loaded and `gh` authed:

```bash
# Custom-booking location (e.g. Dallas):
npm run fork -- <slug> --custom-booking --push

# FareHarbor location:
npm run fork -- <slug> --push
```

This creates `Turbo-Bookings/<slug>-atv-rentals-site`, generates
`src/config/site.ts` from the location row, downloads + wires the assets (logo,
hero videos [content-hashed], OG, gallery, tour photos), and — for
`--custom-booking` — auto-applies the `/book` rewrite, CTA repoint, `BookClick`
event, env-gated pixel, and FareHarbor-machinery removal.

## 4. Content pass (the one manual step)

The generator applies **brand identity automatically** — it reads the location's
`visual_primary_color` / `visual_accent_color` from the dashboard and rewrites
the template's Miami palette across the whole site (globals `@theme`,
`lib/tokens.ts`, component color literals, favicon, `themeColor`), and injects
the deposit `$` amount into the marketing copy. So **set the brand colors in the
dashboard before generating** (or set them later and re-run `npm run fork --
<slug> --assets-only` to re-apply). Fonts are still a manual step (pick the
display font in `layout.tsx` + `globals.css`).

The **prose** is still the template's. Rebrand the homepage + core pages
(pricing/FAQ/groups/policies) to this company: tour count/prices, hero copy, drop
unused locales/sections, real review numbers, **contact phone/address**. Use the
location's real config as the source of truth (don't invent policies).

**Then run the brand linter** — it fails on any leftover Miami placeholders
(red hex, `$50`, Miami phone/address, `takeoversmiami`, Oswald):

```bash
npm run lint:brand   # in the fork repo; must pass before launch
```

The fork CLI runs it automatically at the end of a generate and prints anything
left to fix. Commit to `develop`.

## 5. Vercel project (git-linked)

1. vercel.com/new → import `Turbo-Bookings/<slug>-atv-rentals-site` → production
   branch = `main` (so `develop` deploys previews).
2. Set env vars (see `.env.local.example` in the repo): the fresh Meta pixel
   (`NEXT_PUBLIC_META_PIXEL_ID` + `META_PIXEL_ID`), `META_CAPI_TOKEN`, GA4
   (`NEXT_PUBLIC_GA_MEASUREMENT_ID`), Google Ads (`NEXT_PUBLIC_GOOGLE_ADS_ID`).
   Add `META_TEST_EVENT_CODE` **only** during verification.
3. Deploy the preview.

## 6. Tracking accounts + dashboard config

1. **Create fresh accounts:** Meta pixel (for the domain), GA4 property, Google
   Ads conversion, and a Meta CAPI **System User token**. (Fresh = clean
   baseline; never reuse another location's pixel.)
2. **Dashboard → Location → Settings → Tracking:** enter the pixel/GA4/Ads IDs,
   mode = **Direct**, and for a custom-booking location flip
   **`meta_capi_purchase_enabled` ON**. Under "Server-side events," paste the
   `META_CAPI_TOKEN` secret.
3. **Booking app env check:** the booking app project needs `ADMIN_ENCRYPTION_KEY`
   (same value as the dashboard) so it can decrypt the CAPI token.

## 7. DNS

Point the apex + `www` at Vercel per Vercel's records, attach the domain.

## 8. Verify before going public

- Meta **Pixel Helper** on the preview: pixel + PageView on marketing and
  `/book` pages.
- Walk a Stripe-TEST booking: `BookClick` on the marketing CTA (not
  InitiateCheckout), then in `/book`: ViewContent → AddToCart →
  InitiateCheckout (**once**) → AddPaymentInfo → Purchase.
- Meta Events Manager **Test Events** (with `META_TEST_EVENT_CODE` set): the
  server Purchase arrives and dedupes against the client fire on `booking-<uuid>`.
- GA4 DebugView shows the funnel. Confirm a tour-specific custom audience can be
  built from `BookClick`/AddToCart.
- Remove `META_TEST_EVENT_CODE` before launch.

## 9. Payments readiness gate — all three, in order

Run the automated half first; it checks everything below that a script can see,
plus the catalog, deposit math, timezone, venue-fee coherence, tracking and
retainer:

```
npm run location:preflight -- --slug=<slug>
```

Exits non-zero on a blocker. Needs `STRIPE_SECRET_KEY` in the environment for
the same mode the connected account lives in, or it skips the Stripe checks and
says so rather than passing silently.


Do NOT set `NEXT_PUBLIC_BOOKING_ORIGIN` until every one of these passes. Houston
was flipped live on 2026-08-19 with a connected account that could not yet take
money, and checkout was silently dead for ~25 minutes. Full detail and the Radar
findings: `docs/PAYMENT_RISK_AND_RADAR.md`.

1. **`charges_enabled = true`** on the connected account. This is the gate.
   `payouts_enabled` is NOT — it routinely lags for days while Stripe verifies
   the bank account, holds the money in the Stripe balance, and blocks nothing
   the customer sees.
2. **Load the real checkout and confirm a card form renders**, with the Pay
   button showing the right amount:
   `https://book.<domain>/<slug>/tours/<item-id>` → pick a slot → Continue.
   This is the only check that catches an inactive `card_payments` capability —
   the Payment Element queries the connected account, finds nothing, and renders
   an *empty box* with no error. Takes fifteen seconds. It is the step that
   would have caught Houston; the account looked connected everywhere else.
3. **One real booking, start to finish, then refund it.**

## 10. Launch

- Promote `develop` → `main` (production) once verified — **explicit operator
  confirmation required**.
- Flip the location status to `launched` in the dashboard.

## 11. Updating assets later

Re-upload in the dashboard, then re-sync into the repo (no re-fork):

```bash
npm run fork -- <slug> --assets-only --push
```

Hero videos + OG get new content-hashed filenames automatically, so the cache
busts and returning visitors see the new media.

---

## 12. Gotchas

- **Never reuse a pixel/GA property** across locations — always fresh.
- **`--assets-only` requires the repo to already exist** (run a full fork first).
- The custom-booking transform is **best-effort with guarded patches** — if the
  template drifts, it logs a warning and skips that edit; check the fork output.
- Fresh domain = no legacy redirects needed; the custom-booking transform drops
  the template's Miami/Wix redirect map.

## 13. Roadmap (removing the terminal + more automation)

- **Dashboard "Generate site" button** → runs the fork via a GitHub Action (no
  terminal), so any team member can generate a repo from the dashboard.
- **Auto-provision Vercel + env** from the dashboard (project create + env push).
- **CI hero-video transcode** (ffmpeg in the Action) so even an oversized upload
  is transcoded before it ships.

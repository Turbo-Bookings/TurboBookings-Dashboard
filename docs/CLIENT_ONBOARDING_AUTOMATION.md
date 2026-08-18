# Client-onboarding automation & tracking guardrails

> Why this exists: config that has to be hand-entered in a second place drifts from the source of
> truth, and nothing checks. It bit twice on 2026-08-17 — Dallas was deploy-ready with **zero**
> tracking, and the booking app's hand-set `DATABASE_URL` went stale during a credential rotation.
> Both rendered perfectly while being broken.
>
> Everything here is shaped by one constraint: **a hired employee who does not use Claude Code must
> be able to run it.** A guardrail that depends on remembering a runbook step is not a guardrail.

## ✅ PHASE 1 — Guardrails (DONE 2026-08-17)

| What | Where |
|---|---|
| gtag loads off **either** GA4 or Ads id | `dtown-atv-rentals-site/src/components/tracking/GoogleAnalytics.tsx` |
| Fork transform now **env-gates Google ids** | `scripts/fork.ts` (`applyCustomBookingTransform`) |
| Tracking components log loudly when unset | MetaPixel + GoogleAnalytics, production only |
| `fork.ts` prints a TRACKING NOT CONFIGURED block | `printFollowUps()` |
| **Launch gate** on `status → launched` | `src/lib/actions/lifecycle.ts` (`trackingLaunchBlockers`) |
| Gate surfaced + override w/ audited reason | `src/components/SettingsPanel.tsx` |
| Go-live checklist seeded at location creation | `src/lib/actions/setup.ts` (`seedSetupItemsForLocation`) → called from `locations.ts` |
| `edge_config` item → `tracking_verified` | `src/lib/external-setup/template.ts` |

**Two bugs found and fixed in the process:**
1. A missing GA4 id silently killed the **Google Ads** tag (Ads `gtag('config')` was nested inside the
   GA4 guard) — an Ads id that looked configured and never fired.
2. `fork.ts` env-gated Meta but **never touched Google**, so every generated site would have inherited
   the template's live GA4 property + Ads account. Worse than no tracking: a new location's
   conversions would be reported into **Miami's** property, looking healthy the whole time.

**Known consequence:** the gate blocks `launched` until `verifyTracking()` passes. Dallas is
`building`; flipping it will block until Tracking → "Verify on live site" is run. Correct behaviour —
just sequence it **DNS → verify → launch**, since verification fetches the canonical domain.

## ⏳ PHASE 2 — Config pull (after Dallas + Houston + Miami are live)

Goal: marketing sites read tracking from the dashboard instead of duplicating it in env vars.

**Decisions already made** (don't re-litigate):
- **Cached server fetch / ISR**, not client-side fetch. The root layout is already a server component,
  so IDs stay inlined in server-rendered HTML — the pixel fires as early as today, pages stay static,
  and `verifyTracking()`'s HTML-grep matchers keep working (a client fetch would break them).
- **Baked fallback + distinct error states.** `200 {configured:true}` / `200 {configured:false}` /
  `503 {error}`. On 503 or fetch failure the site falls back to its baked env values; only an explicit
  `configured:false` renders nothing. Never silently zero.
- **CAPI token** keeps flowing via `setProjectEnv()` into the site's own Vercel env (it's a secret and
  can't be served publicly). That function already works — see `src/lib/vercel/env.ts:27-89`.

**Build:**
1. `bookingsystem/src/app/api/tracking-config/route.ts`, modelled on `api/popup-config/route.ts`
   (wildcard CORS, `OPTIONS`, explicit field allowlist, `s-maxage=60, stale-while-revalidate=300`).
   ⚠️ **Do NOT use `resolveTenantBySlug`** — it applies the payment-readiness gate added in
   `bookingsystem/src/lib/tenant.ts`, so a site would get zero tracking until Stripe Connect completes.
   Resolve by slug directly, excluding only `archived`.
2. Marketing site: `await fetch(url, { next: { revalidate: 60 } })` in `src/app/[locale]/layout.tsx`,
   pass IDs as props into MetaPixel / GoogleAnalytics. Add `<link rel="preconnect">` to the booking origin.
3. Serves the currently-dead columns too — `mode`, `gtmContainerId`, `metaDomainVerification`,
   `serverSideGtmEndpoint` — so one template renders direct/gtm_only/hybrid instead of forks diverging.
4. Extend `setSecret()` so saving `META_CAPI_TOKEN` auto-pushes to the site's Vercel project.

**If a CSP is ever added** to a marketing site it must include `connect-src` for the booking origin,
or the config fetch dies silently.

## ⏳ PHASE 3 — "Generate site" button (2027-readiness)

One button, no terminal: repo + Vercel project + env + domains + checklist.

**What already exists:** `scripts/fork.ts` (clone → config → assets → brand → transform → git → push)
and `setProjectEnv()` for env vars — the env half of provisioning is solved.

**What's missing:** *any* GitHub automation (no workflows, no token, no API client anywhere in the
codebase) and Vercel project creation / domain attach.

**Fix `fork.ts`'s staleness first** — it still generates the abandoned `/book` **rewrite** (503s on
`_next`, 404s on internal links), emits a relative `/book` URL that fails typecheck and 404s on
Miami's `es` locale, never patches `src/proxy.ts`, and ignores `visual_display_font` /
`visual_body_font` despite both being in the DB (guaranteeing a manual font fix the brand linter then
fails on).

**Also:** a failed fork leaves `status='building'` **forever** — there is no failure path
(`fork.ts` just `process.exit(1)`).

**Should stay human:** the editorial content pass, tracking-account creation, registrar DNS, and the
`develop → main` promotion.

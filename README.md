# TurboBookings Dashboard

Multi-tenant client portal for ATV-tour location buildouts and operations. Sits above the per-location marketing sites (Miami, HTown, DTown, future) — manages intake, tracking config, external-setup tracking, asset library, and cross-location analytics.

Lives at [dashboard.turbobookings.net](https://dashboard.turbobookings.net).

## Status

**Phase 1 — buildout MVP, in progress.**

The approved plan is at `~/.claude/plans/snazzy-jingling-squirrel.md`. See `AGENTS.md` for project context, cross-repo responsibility split, and the git workflow.

## Local development

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Stack

- Next.js 16 App Router + React 19
- TypeScript + Tailwind CSS v4
- Neon Postgres + Drizzle ORM (planned, provisioned via Vercel Marketplace)
- Clerk auth (planned)
- Vercel Blob + Vercel Edge Config

## Companion repos

| Repo | Purpose |
|---|---|
| [`takeovers-site`](https://github.com/Turbo-Bookings/takeovers-site) | Miami marketing site — the template every location fork comes from |
| [`htown-atv-rentals-site`](https://github.com/Turbo-Bookings/htown-atv-rentals-site) | Houston, first fork |
| Replit `Takeovers-Phone-and-SMS-Agent` | AI receptionist + voice + predictive marketing — the long-term operations brain |

The cross-repo integration contract lives at `~/takeovers-site/docs/unified-platform-integration.md`.
